const express = require('express');
const router = express.Router();
const db = require('../database');

// Middleware to protect admin routes
function checkAdminAuth(req, res, next) {
  if (req.session && req.session.isLoggedIn && req.session.userId) {
    next();
  } else {
    res.redirect('/admin/loginpage');
  }
}

// Admin login page
router.get('/loginpage', (req, res) => {
  res.render('adminLoginPage');
});

// Handle login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE user_name = ?', [username], (err, user) => {
    if (err) return res.status(500).send('Server error');
    if (!user || user.password !== password) {
      return res.status(401).render('errorPage', { message: 'Invalid credentials' });
    }

    req.session.isLoggedIn = true;
    req.session.userId = user.user_id;
    req.session.userName = user.user_name;
    req.session.roleId = user.role_id;

    res.redirect('/admin/home');
  });
});

// Admin homepage
router.get('/home', checkAdminAuth, (req, res) => {
  const userId = req.session.userId;

  db.all(`SELECT * FROM events WHERE created_by = ? ORDER BY created_at DESC`, [userId], (err, events) => {
    if (err) return res.status(500).render('errorPage', { message: 'Failed to fetch events' });

    const eventIds = events.map(e => e.event_id).join(',') || 0;

    db.all(`SELECT * FROM tickets WHERE event_id IN (${eventIds})`, (err2, tickets) => {
      if (err2) return res.status(500).render('errorPage', { message: 'Failed to fetch ticket info' });

      // Load settings using keys
      db.all(`SELECT key, value FROM site_settings WHERE key IN ('site_title', 'site_description')`, (err3, rows) => {
        if (err3 || !rows) {
          console.error('Error loading site settings:', err3);
          return res.status(500).render('errorPage', { message: 'Failed to load settings.' });
        }

        const settings = {};
        rows.forEach(row => {
          if (row.key === 'site_title') settings.siteTitle = row.value;
          if (row.key === 'site_description') settings.siteDescription = row.value;
        });

        settings.adminName = req.session.userName || 'Admin';

        res.render('adminHomePage', {
          settings,
          events: events || [],
          tickets: tickets || []
        });
      });
    });
  });
});

// GET admin settings
router.get('/settings', checkAdminAuth, (req, res) => {
  db.all(`SELECT key, value FROM site_settings WHERE key IN ('site_title', 'site_description')`, (err, rows) => {
    if (err || !rows) return res.status(500).render('errorPage', { message: 'Unable to load settings.' });

    const settings = {};
    rows.forEach(row => {
      if (row.key === 'site_title') settings.siteTitle = row.value;
      if (row.key === 'site_description') settings.siteDescription = row.value;
    });

    res.render('adminSettings', { settings });
  });
});

// POST admin settings
router.post('/settings', checkAdminAuth, (req, res) => {
  const action = req.body.action;

  if (action === 'reset') {
    const defaultTitle = 'Namaste Yoga';
    const defaultDescription = 'Where you can find balance, strength, and peace through mindful yoga practice.';

    db.serialize(() => {
      db.run(`UPDATE site_settings SET value = ? WHERE key = 'site_title'`, [defaultTitle], (err1) => {
        if (err1) {
          console.error('Error resetting site_title:', err1);
          return res.status(500).render('errorPage', { message: 'Failed to reset site title.' });
        }

        db.run(`UPDATE site_settings SET value = ? WHERE key = 'site_description'`, [defaultDescription], (err2) => {
          if (err2) {
            console.error('Error resetting site_description:', err2);
            return res.status(500).render('errorPage', { message: 'Failed to reset site description.' });
          }

          res.redirect('/admin/settings');
        });
      });
    });

  } else {
    // Normal save action
    const { siteTitle, siteDescription } = req.body;

    db.serialize(() => {
      db.run(`UPDATE site_settings SET value = ? WHERE key = 'site_title'`, [siteTitle], (err1) => {
        if (err1) {
          console.error('Error updating site_title:', err1);
          return res.status(500).render('errorPage', { message: 'Failed to update site title' });
        }

        db.run(`UPDATE site_settings SET value = ? WHERE key = 'site_description'`, [siteDescription], (err2) => {
          if (err2) {
            console.error('Error updating site_description:', err2);
            return res.status(500).render('errorPage', { message: 'Failed to update site description' });
          }

          res.redirect('/admin/settings');
        });
      });
    });
  }
});



// Create event form
router.get('/create', checkAdminAuth, (req, res) => {
  res.render('createEvent', { event: null });
});

// Handle create event
router.post('/create', checkAdminAuth, (req, res) => {
  const {
    title, description, start_date, end_date,
    full_price_quantity, full_price,
    concession_quantity, concession_price,
    status,
    ticket_types = [],
    ticket_quantities = [],
    ticket_prices = []
  } = req.body;

  if (!title || !start_date || !end_date || !full_price || !concession_price) {
    return res.render("createEvent", {
      error: "All required fields must be filled.",
      event: req.body
    });
  }

  const created_by = req.session.userId;
  const created_at = new Date().toISOString();
  const last_modified_at = created_at;

  db.run(`
    INSERT INTO events (title, description, created_by, created_at, last_modified_at,
      start_date, end_date, status, full_price, concession_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, description, created_by, created_at, last_modified_at,
     start_date, end_date, status || 'Draft', full_price, concession_price],
    function (err) {
      if (err) {
        console.error("Error creating event:", err);
        return res.render("createEvent", {
          error: "Event creation failed. Please check input.",
          event: req.body
        });
      }

      const eventId = this.lastID;

      const ticketStmt = db.prepare(`INSERT INTO tickets (event_id, type, quantity, price) VALUES (?, ?, ?, ?)`);

      ticketStmt.run(eventId, 'Full', full_price_quantity, full_price);
      ticketStmt.run(eventId, 'Concession', concession_quantity, concession_price);

      // 🔁 CUSTOM TICKETS
      if (Array.isArray(ticket_types)) {
        for (let i = 0; i < ticket_types.length; i++) {
          const type = ticket_types[i];
          const quantity = parseInt(ticket_quantities[i]);
          const price = parseFloat(ticket_prices[i]);

          if (type && !isNaN(quantity) && !isNaN(price)) {
            ticketStmt.run(eventId, type, quantity, price);
          }
        }
      }

      ticketStmt.finalize();
      res.redirect('/admin/home');
    }
  );
});


// Publish/draft routes
router.post('/draft/:id', checkAdminAuth, (req, res) => {
  db.run("UPDATE events SET status = 'Draft' WHERE event_id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).render('errorPage', { message: 'Error saving draft' });
    res.redirect('/admin/home');
  });
});

router.post('/publish/:id', checkAdminAuth, (req, res) => {
  db.run("UPDATE events SET status = 'Published', published_at = datetime('now') || 'Z' WHERE event_id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).render('errorPage', { message: 'Error publishing event' });
    res.redirect('/admin/home');
  });
});

// Admin registration
router.get('/register', (req, res) => res.render('adminRegister'));

router.post('/register', (req, res) => {
  const { username, email, password, confirmPassword } = req.body;
  if (!username || !email || !password || !confirmPassword || password !== confirmPassword) {
    return res.status(400).render('adminRegister', { error: 'All fields are required and passwords must match.' });
  }

  db.run("INSERT INTO users (user_name, password, role_id) VALUES (?, ?, 1)", [username, password], function (err) {
    if (err) return res.status(500).render('adminRegister', { error: 'Error creating user' });

    db.run("INSERT INTO email_accounts (email_address, user_id) VALUES (?, ?)", [email, this.lastID], (err2) => {
      if (err2) console.error('Error adding email:', err2);
      res.redirect('/admin/loginpage');
    });
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).render('errorPage', { message: 'Logout failed.' });
    res.redirect('/admin/loginpage');
  });
});

router.post('/delete-event/:id', checkAdminAuth, (req, res) => {
  const eventId = req.params.id;
  const currentAdminId = req.session.userId;
  
  console.log('Attempting to delete event:', eventId);
  
  // Start a transaction to ensure all deletions succeed or fail together
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // 1. Delete reservations first (this was missing!)
    db.run(`DELETE FROM reservations WHERE event_id = ?`, [eventId], (err) => {
      if (err) {
        console.error('Failed to delete reservations:', err);
        db.run('ROLLBACK');
        return res.status(500).render('errorPage', { message: 'Failed to delete event reservations.' });
      }
      console.log('Reservations deleted');
      
      // 2. Delete tickets
      db.run(`DELETE FROM tickets WHERE event_id = ?`, [eventId], (err) => {
        if (err) {
          console.error('Failed to delete tickets:', err);
          db.run('ROLLBACK');
          return res.status(500).render('errorPage', { message: 'Failed to delete event tickets.' });
        }
        console.log('Tickets deleted');
        
        // 3. Finally delete the event
        db.run(`DELETE FROM events WHERE event_id = ? AND created_by = ?`, [eventId, currentAdminId], function(err) {
          if (err) {
            console.error('Failed to delete event:', err);
            db.run('ROLLBACK');
            return res.status(500).render('errorPage', { message: 'Failed to delete event.' });
          }
          
          if (this.changes === 0) {
            db.run('ROLLBACK');
            return res.status(404).render('errorPage', { message: 'Event not found or you are not authorized to delete this event.' });
          }
          
          // Commit the transaction
          db.run('COMMIT', (err) => {
            if (err) {
              console.error('Failed to commit transaction:', err);
              return res.status(500).render('errorPage', { message: 'Failed to complete deletion.' });
            }
            
            console.log('Event deleted successfully');
            res.redirect('/admin/home');
          });
        });
      });
    });
  });
});

// Edit event
router.get('/edit/:id', (req, res) => {
  const eventId = req.params.id;

  db.get("SELECT * FROM events WHERE event_id = ?", [eventId], (err, event) => {
    if (err || !event) {
      return res.status(404).render('errorPage', { error: 'Event not found.' });
    }

    db.all("SELECT * FROM tickets WHERE event_id = ?", [eventId], (ticketErr, tickets) => {
      if (ticketErr) {
        return res.status(500).render('errorPage', { error: 'Failed to load ticket types.' });
      }

      res.render('editEvent', {
        event,
        tickets // ← This will include Full, Concession, or any custom types
      });
    });
  });
});

router.post('/edit/:id', checkAdminAuth, (req, res) => {
  const {
    title, description, start_date, end_date,
    full_price_quantity, full_price,
    concession_quantity, concession_price,
    ticket_type = [],
    ticket_quantity = [],
    ticket_price = []
  } = req.body;

  const eventId = req.params.id;
  const last_modified_at = new Date().toISOString();

  const parsedFullPrice = parseFloat(full_price);
  const parsedConcessionPrice = parseFloat(concession_price);
  const parsedFullQty = parseInt(full_price_quantity);
  const parsedConcessionQty = parseInt(concession_quantity);

  if (!title || isNaN(parsedFullPrice) || isNaN(parsedConcessionPrice)) {
    return res.status(400).render('errorPage', {
      message: 'Missing title or invalid ticket price values.'
    });
  }

  db.run(`
    UPDATE events SET
      title = ?, description = ?, start_date = ?, end_date = ?, last_modified_at = ?,
      full_price = ?, concession_price = ?
    WHERE event_id = ?
  `, [
    title, description, start_date, end_date, last_modified_at,
    parsedFullPrice, parsedConcessionPrice, eventId
  ], (err) => {
    if (err) {
      console.error('Event update error:', err.message);
      return res.status(500).render('errorPage', { message: 'Event update failed.' });
    }

    // Step 2: Always update default tickets directly
    const updateDefaultTicket = (type, qty, price) => {
      db.run(`UPDATE tickets SET quantity = ?, price = ? WHERE event_id = ? AND type = ?`,
        [qty, price, eventId, type],
        err => {
          if (err) console.error(`Update failed for ticket ${type}:`, err.message);
        });
    };

    updateDefaultTicket('Full', parsedFullQty, parsedFullPrice);
    updateDefaultTicket('Concession', parsedConcessionQty, parsedConcessionPrice);

    // Step 3: Remove old custom ticket types
    db.run(`
      DELETE FROM tickets
      WHERE event_id = ? AND type NOT IN ('Full', 'Concession')
    `, [eventId], (delErr) => {
      if (delErr) {
        console.error('Failed to delete custom tickets:', delErr.message);
        return res.status(500).render('errorPage', { message: 'Failed to clear custom ticket types.' });
      }

      // Step 4: Add new custom ticket types only
      const insertStmt = db.prepare(`
        INSERT INTO tickets (event_id, type, quantity, price) VALUES (?, ?, ?, ?)
      `);

      const types = Array.isArray(ticket_type) ? ticket_type : [ticket_type];
      const quantities = Array.isArray(ticket_quantity) ? ticket_quantity : [ticket_quantity];
      const prices = Array.isArray(ticket_price) ? ticket_price : [ticket_price];

      for (let i = 0; i < types.length; i++) {
        const type = types[i]?.trim();
        const qty = parseInt(quantities[i]);
        const price = parseFloat(prices[i]);

        if (
          type &&
          !['Full', 'Concession'].includes(type) &&
          !isNaN(qty) &&
          !isNaN(price)
        ) {
          insertStmt.run(eventId, type, qty, price, err => {
            if (err) console.error(`Insert failed for ticket "${type}":`, err.message);
          });
        }
      }

      insertStmt.finalize(() => {
        res.redirect('/admin/home');
      });
    });
  });
});


// GET /admin/bookings
router.get('/bookings', checkAdminAuth, (req, res) => {
  const adminId = req.session.userId;

  const bookingsQuery = `
    SELECT 
      r.name,
      r.email_address,
      r.reservation_code,
      r.ticket_type,
      r.quantity,
      e.event_id,
      e.title AS event_title,
      e.start_date,
      e.end_date
    FROM reservations r
    JOIN events e ON r.event_id = e.event_id
    WHERE e.created_by = ?
    ORDER BY e.start_date DESC, r.reservation_id DESC
  `;

  const eventsQuery = `
    SELECT * FROM events WHERE created_by = ? ORDER BY start_date DESC
  `;

  db.all(eventsQuery, [adminId], (eventErr, events) => {
    if (eventErr) {
      console.error("Error loading events:", eventErr);
      return res.status(500).render('errorPage', { message: 'Unable to load events.' });
    }

    db.all(bookingsQuery, [adminId], (bookingErr, bookings) => {
      if (bookingErr) {
        console.error("Error loading bookings:", bookingErr);
        return res.status(500).render('errorPage', { message: 'Unable to load bookings.' });
      }

      res.render('adminViewBookings', {
        bookings,
        events,
        settings: req.session.settings || {} // Optional
      });
    });
  });
});

module.exports = router;
