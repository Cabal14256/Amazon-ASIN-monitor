const message = "测试：这是中文消息";
console.log('[测试消息]', message);
console.log('[UTF-8 HEX]', Buffer.from(message, 'utf-8').toString('hex'));
