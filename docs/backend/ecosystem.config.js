module.exports = {
  apps: [
    {
      name: 'index',           // Ó¦ÓÃÃû³Æ
      script: 'index.js',      // Æô¶¯µÄÎÄ¼þ
      env: {
        NODE_ENV: 'development', // »·¾³±äÁ¿
        SP_API_REFRESH_TOKEN: process.env.SP_API_REFRESH_TOKEN,
        SP_API_CLIENT_ID: process.env.SP_API_CLIENT_ID,
        SP_API_CLIENT_SECRET: process.env.SP_API_CLIENT_SECRET,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        SP_API_ROLE_ARN: process.env.SP_API_ROLE_ARN
      }
    }
  ]
};
