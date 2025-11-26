const { globalAlertMessage, globalAlertType } = require('../config/system');

exports.getAlert = async (req, res) => {
  res.json({
    success: true,
    data: {
      message: globalAlertMessage,
      type: globalAlertMessage ? globalAlertType : 'info',
    },
    errorCode: 0,
  });
};
