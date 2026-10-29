'use strict';
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { requirePerm } = require('../middleware/auth');
const { asyncH, fail } = require('../utils/http');
const { db } = require('../db/connection');
const { audit } = require('../middleware/audit');

const router = express.Router();
fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, env.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '') || '.png';
    const base = (req.body.slot === 'logo' ? 'logo' : 'img-' + Date.now());
    cb(null, base + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Solo se aceptan imagenes PNG, JPG, WEBP o SVG.'),
        { status: 400, expose: true }));
    }
    cb(null, true);
  }
});

router.post('/upload', requirePerm('settings.manage', 'products.manage'),
  upload.single('file'), asyncH((req, res) => {
    if (!req.file) fail('No se recibio ningun archivo.');
    const url = '/uploads/' + req.file.filename;
    if (req.body.slot === 'logo') {
      db.prepare('UPDATE business_settings SET logo_path = ? WHERE id = 1').run(url);
      audit(req, { action: 'update', entity: 'business_settings', entityId: 1, description: 'Logo actualizado' });
    }
    res.status(201).json({ path: url });
  }));

module.exports = router;
