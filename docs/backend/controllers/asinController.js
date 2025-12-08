const fs = require('fs');
const path = require('path');
const asinPath = path.join(__dirname, '../data/asins.json');

function addAsin(req, res) {
  const { asin } = req.body;
  const asins = JSON.parse(fs.readFileSync(asinPath));
  if (!asins.includes(asin)) {
    asins.push(asin);
    fs.writeFileSync(asinPath, JSON.stringify(asins, null, 2));
  }
  res.json({ success: true, asins });
}

function getAsins(req, res) {
  const asins = JSON.parse(fs.readFileSync(asinPath));
  res.json({ asins });
}

module.exports = { addAsin, getAsins };
