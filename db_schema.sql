-- Roles table
CREATE TABLE roles (
    role_id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name TEXT NOT NULL UNIQUE
);

-- Users table
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    password TEXT NOT NULL,
    role_id INTEGER,
    FOREIGN KEY (role_id) REFERENCES roles(role_id)
);

-- Email accounts table
CREATE TABLE email_accounts (
    email_account_id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_address TEXT NOT NULL,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Site settings table
CREATE TABLE site_settings (
    key TEXT PRIMARY KEY, -- e.g., 'site_title', 'site_description'
    value TEXT NOT NULL
);

-- Events table
CREATE TABLE events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    start_date DATETIME,
    end_date DATETIME,
    status TEXT DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published')),
    full_price DECIMAL(10, 2) NOT NULL,
    concession_price DECIMAL(10, 2) NOT NULL,
    max_capacity INTEGER DEFAULT 50,
    FOREIGN KEY (created_by) REFERENCES users(user_id)
);

-- ✅ Modified tickets table (removed CHECK constraint)
CREATE TABLE tickets (
    ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- allows custom ticket types
    quantity INTEGER NOT NULL,
    quantity_sold INTEGER DEFAULT 0,
    price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (event_id) REFERENCES events(event_id)
);

-- ✅ Modified reservations table (removed CHECK constraint)
CREATE TABLE reservations (
    reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_code TEXT,
    name TEXT NOT NULL,
    email_address TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    ticket_type TEXT NOT NULL, -- allows custom types
    quantity INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (event_id) REFERENCES events(event_id)
);

-- Default roles
INSERT INTO roles (role_name) VALUES ('Admin'), ('User');

-- Default users
INSERT INTO users (user_name, password, role_id) VALUES 
('Simon Star', 'simonstar', 1), 
('Dianne Dean', 'diannedean', 2), 
('Harry Hilbert', 'harryhilbert', 2);

-- Default emails
INSERT INTO email_accounts (email_address, user_id) VALUES 
('simon@gmail.com', 1), 
('dianne@yahoo.co.uk', 2),
('harry@outlook.com', 3);

-- Site title & description
INSERT INTO site_settings (key, value) VALUES 
('site_title', 'Namaste Yoga'),
('site_description', 'Where you can find balance, strength, and peace through mindful yoga practice.');

-- Events
INSERT INTO events (
    title, description, created_by, created_at, last_modified_at, published_at,
    start_date, end_date, status, full_price, concession_price, max_capacity
) VALUES 
(
    'Evening Stretch',
    'A calming yoga event with gentle stretches.',
    1,
    '2025-06-20 10:00:00',
    '2025-06-20 10:00:00',
    '2025-06-21 10:00:00',
    '2025-06-25 18:00:00',
    '2025-06-25 19:00:00',
    'Published',
    22.00,
    16.50,
    30
),
(
    'Morning Flow',
    'Energizing morning yoga session to start your day.',
    1,
    '2025-06-20 10:00:00',
    '2025-06-20 10:00:00',
    '2025-06-21 10:00:00',
    '2025-06-26 08:00:00',
    '2025-06-26 09:00:00',
    'Published',
    25.00,
    18.00,
    25
);

-- Tickets
INSERT INTO tickets (event_id, type, quantity, price) VALUES
(1, 'Full', 20, 22.00),
(1, 'Concession', 10, 16.50),
(2, 'Full', 15, 25.00),
(2, 'Concession', 10, 18.00);

-- Sample reservations
INSERT INTO reservations (reservation_code, name, email_address, event_id, ticket_type, quantity) VALUES
('RSV-X9A7B2', 'Dianne Dean', 'dianne@yahoo.co.uk', 1, 'Full', 1),
('RSV-C7P3ZQ', 'Harry Hilbert', 'harry@outlook.com', 1, 'Concession', 1),
('RSV-LM0N56', 'Dianne Dean', 'dianne@yahoo.co.uk', 2, 'Full', 2);

-- Update ticket sales
UPDATE tickets 
SET quantity_sold = (
    SELECT COALESCE(SUM(r.quantity), 0) 
    FROM reservations r 
    WHERE r.event_id = tickets.event_id 
    AND r.ticket_type = tickets.type
);

-- Sample Queries

-- All events
SELECT 'EVENTS:' as label;
SELECT * FROM events;

-- All tickets
SELECT 'TICKETS:' as label;
SELECT * FROM tickets;

-- All reservations
SELECT 'RESERVATIONS:' as label;
SELECT * FROM reservations;

-- Booking Summary
SELECT 
    e.title,
    e.start_date,
    e.max_capacity,
    COUNT(r.reservation_id) as total_bookings,
    SUM(r.quantity) as total_attendees,
    (e.max_capacity - COALESCE(SUM(r.quantity), 0)) as remaining_capacity
FROM events e
LEFT JOIN reservations r ON e.event_id = r.event_id
GROUP BY e.event_id;

-- User reservation summary
SELECT 
    r.name,
    r.email_address,
    e.title as event_title,
    e.start_date,
    r.ticket_type,
    r.quantity,
    r.reservation_code
FROM reservations r
JOIN events e ON r.event_id = e.event_id
ORDER BY r.reservation_id;
