// ? ¼ÓÔØ .env »·¾³±äÁ¿£¨È·±£ÄãÓÐÒ»¸ö .env ÎÄ¼þ£©
require('dotenv').config();

// ? ÒýÈë mysql2 µÄ Promise °æ±¾£¬ÓÃÓÚÒì²½/await ²Ù×÷
const mysql = require('mysql2/promise');

// ? ´´½¨ MySQL Á¬½Ó³Ø£¬Ìá¸ßÐÔÄÜ²¢×Ô¶¯¹ÜÀíÁ¬½Ó
const pool = mysql.createPool({
  host: process.env.DB_HOST,         // Êý¾Ý¿âÖ÷»úµØÖ·£¬ÀýÈç£ºlocalhost »ò 127.0.0.1
  user: process.env.DB_USER,         // Êý¾Ý¿âÓÃ»§Ãû£¬ÀýÈç£ºroot
  password: process.env.DB_PASSWORD, // Êý¾Ý¿âÃÜÂë
  database: process.env.DB_NAME,     // ÒªÁ¬½ÓµÄÊý¾Ý¿âÃû³Æ£¬Èç asin_monitor
  waitForConnections: true,          // µ±Á¬½Ó³ØÂúÊ±ÊÇ·ñµÈ´ý£¨true = µÈ´ý£»false = ±¨´í£©
  connectionLimit: 10,               // ×î´ó²¢·¢Á¬½ÓÊý
  queueLimit: 0                      // Á¬½ÓÇëÇó¶ÓÁÐ×î´ó³¤¶È£¨0 ±íÊ¾ÎÞÏÞÖÆ£©
});

// ? µ¼³öÁ¬½Ó³Ø¶ÔÏó£¬¹©ÆäËûÄ£¿éÊ¹ÓÃ
module.exports = pool;
