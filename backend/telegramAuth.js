import crypto from 'crypto';
export function validateInitData(initData, botToken) {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  if (!hash) return false;
  const dataCheckArr = [];
  urlParams.forEach((value, key) => { if (key !== 'hash') dataCheckArr.push(`${key}=${value}`); });
  dataCheckArr.sort();
  const dataCheckString = dataCheckArr.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return hmac === hash;
}