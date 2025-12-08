const message = "²âÊÔ£ºÕâÊÇÖÐÎÄÏûÏ¢";
console.log('[²âÊÔÏûÏ¢]', message);
console.log('[UTF-8 HEX]', Buffer.from(message, 'utf-8').toString('hex'));
