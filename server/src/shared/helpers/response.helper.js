function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

function paginated(res, data, meta) {
  return res.status(200).json({ success: true, data, meta });
}

module.exports = { success, paginated };
