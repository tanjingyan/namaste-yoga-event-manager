const express = require('express');
const app = express();
const port = 3000;
const { format } = require('date-fns');

const session = require('express-session');  // <-- Add this
var bodyParser = require("body-parser");

app.use(bodyParser.urlencoded({ extended: true }));

// Session middleware must be added BEFORE routes
app.use(session({
  secret: 'your-secret-key',  // replace with your secret
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }  // set to true if HTTPS is enabled
}));

app.set('view engine', 'ejs'); // set the app to use ejs for rendering
app.use(express.static(__dirname + '/public')); // set location of static files

const adminRoutes = require('./routes/adminRoutes');

const sqlite3 = require('sqlite3').verbose();
global.db = new sqlite3.Database('./database.db', function(err){
    if(err){
        console.error(err);
        process.exit(1);
    } else {
        console.log("Database connected");
        global.db.run("PRAGMA foreign_keys=ON");
    }
});

app.locals.formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return format(new Date(dateString), 'PPP p'); // Example: Jun 15, 2025 at 10:30 AM
};

app.get('/', (req, res) => {
    res.render('homePage');
});

app.use('/admin', adminRoutes);

const userRoutes = require('./routes/userRoutes');
app.use('/user', userRoutes);


app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
