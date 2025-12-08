// utils/asinLoader.js
const db = require('./db');

/**
 * ´ÓÊý¾Ý¿âÖÐ»ñÈ¡ËùÓÐ ASIN£¨½¨ÒéÖ»È¡·Ç¿ÕµÄÓÐÐ§ ASIN£©
 */
async function loadAsins() {
  try {
    const [rows] = await db.query('SELECT asin FROM asins WHERE asin IS NOT NULL');
    return rows.map(row => row.asin);
  } catch (error) {
    console.error('»ñÈ¡Êý¾Ý¿â ASIN ÁÐ±íÊ§°Ü:', error);
    return [];
  }
}

module.exports = loadAsins;
