'use strict';

async function checkConnection(env = process.env, fetcher = fetch) {
  const account = env.MB_BANK_ACCOUNT_NUMBER;
  if (!/^[0-9]{6,25}$/.test(account || '')) {
    return { connected: false, message: 'Thiếu MB_BANK_ACCOUNT_NUMBER hợp lệ.' };
  }
  const token = env.SEPAY_READ_API_TOKEN;
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) {
    return { connected: false, message: 'Thiếu SEPAY_READ_API_TOKEN trong Vercel.' };
  }
  const headers = { Authorization: 'Bearer ' + token.trim(), Accept: 'application/json' };
  async function get(path) {
    const response = await fetcher('https://my.sepay.vn/userapi/' + path, {
      headers, redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('provider_unavailable');
    const data = await response.json();
    if (data?.status !== 200 || data?.messages?.success !== true || data.error) {
      throw new Error('provider_rejected');
    }
    return data;
  }
  try {
    const accounts = await get('bankaccounts/list?limit=100');
    if (!Array.isArray(accounts.bankaccounts)) throw new Error('invalid_response');
    const matches = accounts.bankaccounts.filter(item => item &&
      String(item.account_number) === account && String(item.bank_bin) === '970422');
    if (matches.length !== 1 || String(matches[0].active) !== '1') {
      return { connected: false, message: 'Chưa tìm thấy đúng tài khoản MB Bank đang hoạt động trong 100 tài khoản trả về.' };
    }
    const transactions = await get('transactions/list?account_number=' +
      encodeURIComponent(account) + '&limit=1');
    if (!Array.isArray(transactions.transactions) ||
        transactions.transactions.some(item => !item || String(item.account_number) !== account)) {
      throw new Error('invalid_response');
    }
    return {
      connected: true, accountLast4: account.slice(-4),
      transactionReadAccess: true, hasRecentTransaction: transactions.transactions.length > 0,
      message: 'Đã đọc được tài khoản MB Bank và API giao dịch.'
    };
  } catch {
    return {
      connected: false,
      message: 'Chưa xác minh được API SePay. Kiểm tra token, quyền đọc tài khoản/giao dịch hoặc thử lại khi kết nối ổn định.'
    };
  }
}
module.exports = { checkConnection };
