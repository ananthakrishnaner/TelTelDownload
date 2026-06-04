const express = require('express');
const router = express.Router();
const schedulerController = require('../controllers/schedulerController');

router.get('/', schedulerController.getTasks);
router.post('/', schedulerController.createTask);
router.put('/:id', schedulerController.updateTask);
router.delete('/:id', schedulerController.deleteTask);
router.post('/:id/run-now', schedulerController.runNow);
router.get('/:id/runs', schedulerController.getTaskRuns);

module.exports = router;
