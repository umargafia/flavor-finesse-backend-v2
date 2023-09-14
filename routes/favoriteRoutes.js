const express = require('express');

const authController = require('./../controllers/authController');
const favoriteController = require('../controllers/favoriteController');

const router = express.Router();

// Protect all routes after this middleware
router.use(authController.protect);

router.post('/create', favoriteController.addToFavorites);
router.get('/', favoriteController.getUserFavorites);
router.delete('/remove', favoriteController.removeFromFavorites);

module.exports = router;
