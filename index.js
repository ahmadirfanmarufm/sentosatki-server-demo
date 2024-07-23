require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dbHost = process.env.DB_HOST;
const dbUsername = process.env.DB_USERNAME;
const dbPassword = process.env.DB_PASSWORD;
const dbDBName = process.env.DB_DBNAME;

const app = express();
const port = process.env.PORT;

app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

const db = mysql.createConnection({
    host: dbHost,
    user: dbUsername,
    password: dbPassword,
    database: dbDBName
});

db.connect((err) => {
    if (err) {
        console.error('Error connecting to database:', err.stack);
        return;
    }
    console.log('Connected to database as ID:', db.threadId);
});

// Register endpoint
app.get('/register/:nama_staff/:username/:password/:jabatan/', (req, res) => {
    const { nama_staff, username, password, jabatan, image } = req.params;

    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            console.error('Error hashing password:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        const sql = `INSERT INTO staff (nama_staff, username, password, jabatan) VALUES (?, ?, ?, ?)`;
        db.query(sql, [nama_staff, username, hashedPassword, jabatan], (err, result) => {
            if (err) {
                console.error('Error inserting user data:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(201).json({ message: 'User registered successfully' });
        });
    });
});

// Login endpoint
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT id, nama_staff, jabatan, image, password, last_login FROM staff WHERE username = ?';
    
    db.query(query, [username], (err, results) => {
        if (err) throw err;
        if (results.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
        
        const user = results[0];
        
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) throw err;
            if (!isMatch) {
                return res.status(401).json({ message: 'Invalid username or password' });
            }
            
            // Update last_login saat user berhasil login
            const updateLastLoginQuery = 'UPDATE staff SET last_login = CURRENT_TIMESTAMP WHERE id = ?';
            db.query(updateLastLoginQuery, [user.id], (err) => {
                if (err) {
                    console.error('Error updating last login:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                // Sign JWT token without expiresIn
                const token = jwt.sign({ id: user.id, jabatan: user.jabatan, image: user.image }, 'sentosa9898');
                res.cookie('token', token, { httpOnly: true, secure: true });
                res.json({ token });
            });
        });
    });
});

// Middleware untuk memverifikasi token
const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'Token is required' });
    jwt.verify(token.split(' ')[1], 'sentosa9898', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Endpoint untuk memverifikasi token
app.get('/verify', authenticateToken, (req, res) => {
    const { id, jabatan, image } = req.user;
    const query = 'SELECT nama_staff, image FROM staff WHERE id = ?';

    db.query(query, [id], (err, results) => {
        if (err) {
            console.error('Error fetching staff data', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { nama_staff, image } = results[0];

        // Sign JWT token without expiresIn
        const token = jwt.sign({ id, jabatan, image }, 'sentosa9898');
        res.json({ nama_staff, jabatan, image, token });
    });
});

// Endpoint untuk menambahkan berita
app.post('/add-news', upload.single('image'), (req, res) => {
    const { id, title, category, date, author_name, author_role, author_image_url, content } = req.body;
    const image = req.file ? req.file.filename : null;

    const sql = 'INSERT INTO news SET ?';
    db.query(sql, { id, title, category, image, date, author_name, author_role, author_image_url, content }, (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.send(result);
    });
});

// Endpoint untuk mendapatkan URL gambar
app.get('/uploads/:imageName', (req, res) => {
    const imageName = req.params.imageName;
    const imagePath = path.join(__dirname, 'uploads', imageName);
    res.sendFile(imagePath);
});

// Endpoint untuk mengambil data berita
app.get('/berita', (req, res) => {
    const sql = 'SELECT * FROM news';

    db.query(sql, (err, result) => {
        if(err) {
            return res.status(500).send(err);
        }
        res.send(result);
    })
})

// Endpoint untuk mendapatkan berita berdasarkan ID
app.get('/berita/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'SELECT * FROM news WHERE id = ?';

    db.query(sql, [id], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.send(result[0]);
    });
});

// Function to update news in database
function updateNews(newsId, title, category, content, imagePath) {
    return new Promise((resolve, reject) => {
        let sql = '';
        let params = [];

        if (imagePath) {
            // Jika ada imagePath (gambar baru), gunakan gambar baru
            sql = 'UPDATE news SET title = ?, category = ?, content = ?, image = ? WHERE id = ?';
            params = [title, category, content, imagePath, newsId];
        } else {
            // Jika tidak ada imagePath, gunakan query tanpa image
            sql = 'UPDATE news SET title = ?, category = ?, content = ? WHERE id = ?';
            params = [title, category, content, newsId];
        }

        db.query(sql, params, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

// Endpoint untuk mengedit berita berdasarkan ID
app.put('/edit-news/:id', upload.single('image'), (req, res) => {
    const newsId = req.params.id;
    const { title, category, content } = req.body;
    let imagePath = '';

    if (req.file) {
        // Jika ada gambar baru dipilih, gunakan gambar tersebut
        imagePath = req.file.filename;

        // Hapus gambar lama jika ada
        const sqlImageQuery = 'SELECT image FROM news WHERE id = ?';
        db.query(sqlImageQuery, [newsId], (err, result) => {
            if (err) {
                console.error('Error fetching old image:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (result.length > 0 && result[0].image) {
                const oldImagePath = path.join(__dirname, 'uploads', result[0].image);
                // Hapus gambar lama dari server
                fs.unlink(oldImagePath, (err) => {
                    if (err) {
                        console.error('Error deleting old image:', err);
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                });
            }

            // Lakukan update news dengan atau tanpa gambar baru
            updateNews(newsId, title, category, content, imagePath)
                .then(result => {
                    res.json({ message: 'News edited successfully' });
                })
                .catch(error => {
                    console.error('Error editing news:', error);
                    res.status(500).json({ error: 'Internal server error' });
                });
        });
    } else {
        // Jika tidak ada gambar baru dipilih
        updateNews(newsId, title, category, content, imagePath)
            .then(result => {
                res.json({ message: 'News edited successfully' });
            })
            .catch(error => {
                console.error('Error editing news:', error);
                res.status(500).json({ error: 'Internal server error' });
            });
    }
});

app.delete('/delete-news/:id', (req, res) => {
    const { id } = req.params;
    const getImageQuery = 'SELECT image FROM news WHERE id = ?';
    db.query(getImageQuery, [id], (err, results) => {
        if (err) {
            console.error('Error getting image filename:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'News not found' });
        }

        const imageName = results[0].image;

        const deleteNewsQuery = 'DELETE FROM news WHERE id = ?';
        db.query(deleteNewsQuery, [id], (err, result) => {
            if (err) {
                console.error('Error deleting news:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (imageName) {
                const imagePath = path.join(__dirname, 'uploads', imageName);
                fs.unlink(imagePath, (err) => {
                    if (err) {
                        console.error('Error deleting image file:', err);
                    }
                });
            }
            res.json({ message: 'News deleted successfully' });
        });
    });
});

app.get("/api/jobs", (req, res) => {
    const query = `
        SELECT p.id, p.name AS position, s.name AS sector, dc.country AS location, p.totalWorker AS worker, p.contractPeriod, p.salary, p.dateUpload, p.image
        FROM positions p
        JOIN destination_countries dc ON p.country_id = dc.id
        JOIN sectors s ON p.sector_id = s.id
    `;
    db.query(query, (err, results) => {
        if (err) throw err;
        res.json(results);
    });
});

app.get('/api/jobs/:id', (req, res) => {
    const jobId = req.params.id;
    const query = `
        SELECT positions.*, destination_countries.country, sectors.name AS sector
        FROM positions
        JOIN destination_countries ON positions.country_id = destination_countries.id
        JOIN sectors ON positions.sector_id = sectors.id
        WHERE positions.id = ?
    `;

    db.query(query, [jobId], (err, result) => {
        if (err) {
            return res.status(500).json({ message: err.message })
        };

        const job = result[0];

        if(!job) {
            return res.status(404).json({ message: 'Job Not Found' })
        }

        const tasksQuery = 'SELECT task FROM tasks WHERE position_id = ?';
        const documentRequirementsQuery = 'SELECT document FROM document_requirements WHERE position_id = ?';
        const requirementsQuery = 'SELECT * FROM requirements WHERE position_id = ?';
        const workingConditionsQuery = 'SELECT * FROM working_conditions WHERE position_id = ?';

        const getDetails = (query, jobId) => {
            return new Promise((resolve, reject) => {
                db.query(query, [jobId], (err, result) => {
                    if (err) reject(err);
                    resolve(result);
                });
            });
        };

        Promise.all([
            getDetails(tasksQuery, jobId),
            getDetails(documentRequirementsQuery, jobId),
            getDetails(requirementsQuery, jobId),
            getDetails(workingConditionsQuery, jobId)
        ]).then(([tasks, documents, requirements, workingConditions]) => {
            res.json({
                ...job,
                tasks,
                documentRequirements: documents,
                requirements: requirements[0],
                workingConditions: workingConditions[0]
            });
        }).catch((err) => {
            res.status(500).json({ error: err.message });
        });
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
