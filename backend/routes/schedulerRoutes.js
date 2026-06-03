const express = require('express');
const router = express.Router();
const schedulerController = require('../controllers/schedulerController');

router.get('/', schedulerController.getTasks);
router.post('/', schedulerController.createTask);
router.put('/:id', schedulerController.updateTask);
router.delete('/:id', schedulerController.deleteTask);

module.exports = router;
