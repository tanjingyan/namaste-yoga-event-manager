const express = require('express');
const router = express.Router();
const db = require('../database');
const PDFDocument = require('pdfkit');

function generateReservationCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RSV-${result}`;
}

function getUniqueReservationCode(callback) {
  const tryCode = () => {
    const code = generateReservationCode();
    db.get(`SELECT COUNT(*) AS count FROM reservations WHERE reservation_code = ?`, [code], (err, row) => {
      if (err) return callback(err, null);
      if (row.count > 0) {
        tryCode();
      } else {
        callback(null, code);
      }
    });
  };
  tryCode();
}

router.get('/home', (req, res) => {
  db.all("SELECT * FROM events WHERE status = 'Published' ORDER BY start_date ASC", [], (err, events) => {
    if (err) return res.status(500).render('errorPage', { error: 'Failed to load events.' });

    db.all("SELECT * FROM tickets", [], (ticketErr, tickets) => {
      if (ticketErr) return res.status(500).render('errorPage', { error: 'Failed to load tickets.' });

      res.render('userHomePage', {
        events,
        tickets,
        searchResult: null,
        searchTried: false
      });
    });
  });
});

router.get('/make-yoga-session-booking/:id', (req, res) => {
  const eventId = req.params.id;

  db.get("SELECT * FROM events WHERE event_id = ?", [eventId], (err, event) => {
    if (err || !event) return res.status(404).render('errorPage', { error: 'Event not found.' });

    db.all("SELECT * FROM tickets WHERE event_id = ?", [eventId], (ticketErr, tickets) => {
      if (ticketErr) return res.status(500).render('errorPage', { error: 'Could not load ticket info.' });

      const ticketOptions = tickets.map(t => ({
        type: t.type,
        remaining: t.quantity - t.quantity_sold,
        price: t.price
      }));

      res.render('eventBooking', { event, ticketOptions });
    });
  });
});

router.post('/make-yoga-session-booking/:id', (req, res) => {
  const eventId = req.params.id;
  const { name, email, quantities } = req.body;

  if (!name || !email || !quantities || typeof quantities !== 'object') {
    return res.status(400).render('errorPage', { message: 'All fields are required.' });
  }

  // Filter valid tickets
  const validTickets = Object.entries(quantities)
    .filter(([type, qty]) => parseInt(qty) > 0)
    .map(([type, qty]) => ({ type, quantity: parseInt(qty) }));

  if (validTickets.length === 0) {
    return res.status(400).render('errorPage', { message: 'Please select at least one ticket type.' });
  }

  // Get ticket info from DB
  db.all(`SELECT * FROM tickets WHERE event_id = ?`, [eventId], (err, rows) => {
    if (err || !rows || rows.length === 0) {
      return res.status(500).render('errorPage', { message: 'No tickets found for this event.' });
    }

    const ticketMap = {};
    rows.forEach(ticket => {
      ticketMap[ticket.type] = ticket;
    });

    // Check ticket availability
    for (const ticket of validTickets) {
      const row = ticketMap[ticket.type];
      if (!row) {
        return res.status(400).render('errorPage', { message: `Ticket type "${ticket.type}" not found.` });
      }

      const remaining = row.quantity - row.quantity_sold;
      if (ticket.quantity > remaining) {
        return res.status(400).render('errorPage', {
          message: `Only ${remaining} ticket(s) left for ${ticket.type}.`
        });
      }
    }

    // Generate unique reservation code
    getUniqueReservationCode((errCode, reservationCode) => {
      if (errCode) {
        return res.status(500).render('errorPage', { message: 'Could not generate reservation code.' });
      }

      const insertStmt = db.prepare(`
        INSERT INTO reservations (reservation_code, name, email_address, event_id, ticket_type, quantity)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const updateStmt = db.prepare(`
        UPDATE tickets SET quantity_sold = quantity_sold + ? WHERE event_id = ? AND type = ?
      `);

      db.serialize(() => {
        validTickets.forEach(ticket => {
          insertStmt.run(reservationCode, name, email, eventId, ticket.type, ticket.quantity);
          updateStmt.run(ticket.quantity, eventId, ticket.type);
        });

        insertStmt.finalize();
        updateStmt.finalize();

        // Fetch all reservation rows by reservation code (including price)
        db.all(`
          SELECT r.ticket_type, r.quantity, t.price
          FROM reservations r
          JOIN tickets t ON r.event_id = t.event_id AND r.ticket_type = t.type
          WHERE r.reservation_code = ?
        `, [reservationCode], (resErr, ticketRows) => {
          if (resErr || !ticketRows || ticketRows.length === 0) {
            return res.status(500).render('errorPage', { message: 'Reservation saved, but ticket info missing.' });
          }

          const detailedTickets = ticketRows.map(t => ({
            type: t.ticket_type,
            quantity: t.quantity,
            price: t.price
          }));

          // Now fetch the event for final confirmation
          db.get("SELECT * FROM events WHERE event_id = ?", [eventId], (eventErr, event) => {
            if (eventErr || !event) {
              return res.status(500).render('errorPage', { message: 'Event data not found.' });
            }

            res.render('reservationSuccess', {
              event,
              reservation: {
                name,
                email,
                reservation_code: reservationCode,
                tickets: detailedTickets  // ✅ array of ticket objects
              }
            });
          });
        });
      });
    });
  });
});


router.get('/search-reservation', (req, res) => {
  const code = req.query.code?.trim().toUpperCase();
  const email = req.query.email?.trim().toLowerCase();

  if (!code || !email) return res.redirect('/user/home');

  const query = `
    SELECT r.*, e.title, e.start_date, e.end_date
    FROM reservations r
    JOIN events e ON r.event_id = e.event_id
    WHERE UPPER(r.reservation_code) = ? AND LOWER(r.email_address) = ?
  `;

  db.get(query, [code, email], (err, result) => {
    if (err) return res.status(500).render('errorPage', { error: 'Search failed.' });

    db.all("SELECT * FROM events WHERE status = 'Published' ORDER BY start_date ASC", [], (fetchErr, events) => {
      if (fetchErr) return res.status(500).render('errorPage', { error: 'Failed to reload events.' });

      db.all("SELECT * FROM tickets", [], (ticketErr, tickets) => {
        if (ticketErr) return res.status(500).render('errorPage', { error: 'Failed to load tickets.' });

        res.render('userHomePage', {
          events,
          tickets,
          searchResult: result || null,
          searchTried: true
        });
      });
    });
  });
});


router.get('/download-confirmation-pdf/:reservationCode', (req, res) => {
  const reservationCode = req.params.reservationCode.toUpperCase();

  const query = `
    SELECT r.*, e.title, e.start_date, e.end_date, t.price
    FROM reservations r
    JOIN events e ON r.event_id = e.event_id
    JOIN tickets t ON r.event_id = t.event_id AND r.ticket_type = t.type
    WHERE UPPER(r.reservation_code) = ?
  `;

  db.all(query, [reservationCode], (err, rows) => {
    if (err || !rows || rows.length === 0) return res.status(404).send('Reservation not found');

    const { name, email_address, title, start_date, end_date } = rows[0]; // shared info
    const doc = new PDFDocument();
    res.setHeader('Content-Disposition', `attachment; filename=confirmation-${reservationCode}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    doc.fontSize(18).text('Booking Confirmation', { underline: true });
    doc.moveDown();

    doc.fontSize(12);
    doc.text(`Reservation Code: ${reservationCode}`);
    doc.text(`Name: ${name}`);
    doc.text(`Email: ${email_address}`);
    doc.text(`Event: ${title}`);
    doc.text(`Date: ${start_date} to ${end_date}`);
    doc.moveDown().text('Tickets:', { underline: true });

    let grandTotal = 0;
    rows.forEach(r => {
      const lineTotal = r.quantity * r.price;
      grandTotal += lineTotal;
      doc.text(`- ${r.ticket_type}: ${r.quantity} x $${r.price.toFixed(2)} = $${lineTotal.toFixed(2)}`);
    });

    doc.moveDown();
    doc.text(`Total Amount: $${grandTotal.toFixed(2)}`, { bold: true });

    doc.end();
  });
});

router.get('/download-confirmation-txt/:reservationCode', (req, res) => {
  const reservationCode = req.params.reservationCode.toUpperCase();

  const query = `
    SELECT r.*, e.title, e.start_date, e.end_date, t.price
    FROM reservations r
    JOIN events e ON r.event_id = e.event_id
    JOIN tickets t ON r.event_id = t.event_id AND r.ticket_type = t.type
    WHERE UPPER(r.reservation_code) = ?
  `;

  db.all(query, [reservationCode], (err, rows) => {
    if (err || !rows || rows.length === 0) return res.status(404).send('Reservation not found');

    const { name, email_address, title, start_date, end_date } = rows[0]; // shared info

    let textContent = `Booking Confirmation

Reservation Code: ${reservationCode}
Name: ${name}
Email: ${email_address}
Event: ${title}
Date: ${start_date} to ${end_date}

Tickets:
`;

    let grandTotal = 0;
    rows.forEach(r => {
      const lineTotal = r.quantity * r.price;
      grandTotal += lineTotal;
      textContent += `- ${r.ticket_type}: ${r.quantity} x $${r.price.toFixed(2)} = $${lineTotal.toFixed(2)}\n`;
    });

    textContent += `\nTotal Amount: $${grandTotal.toFixed(2)}\n`;

    res.setHeader('Content-Disposition', `attachment; filename=confirmation-${reservationCode}.txt`);
    res.setHeader('Content-Type', 'text/plain');
    res.send(textContent);
  });
});


router.get('/managebooking', (req, res) => {
  const { code, email } = req.query;

  if (!code || !email) {
    return res.render('manageBooking', { searchResults: null, searchTried: false });
  }

  const query = `
    SELECT r.*, e.title, e.start_date, e.end_date
    FROM reservations r
    JOIN events e ON r.event_id = e.event_id
    WHERE UPPER(r.reservation_code) = ? AND LOWER(r.email_address) = ?
  `;

  db.all(query, [code.toUpperCase(), email.toLowerCase()], (err, rows) => {
    if (err || !rows || rows.length === 0) {
      return res.render('manageBooking', { searchResults: null, searchTried: true });
    }

    res.render('manageBooking', {
      searchResults: rows,
      searchTried: true,
      formatDate: (date) => new Date(date).toLocaleString('en-SG', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    });
  });
});

module.exports = router;
