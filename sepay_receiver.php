<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('Asia/Ho_Chi_Minh');

function respond(int $status, array $body): void { http_response_code($status); echo json_encode($body, JSON_UNESCAPED_UNICODE); exit; }
function request(string $url, string $method = 'GET', ?string $body = null, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HEADER => true, CURLOPT_FOLLOWLOCATION => false]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $response = curl_exec($ch);
    if ($response === false) { $error = curl_error($ch); curl_close($ch); throw new RuntimeException('HTTP request failed: ' . $error); }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerLength = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return [$status, substr($response, $headerLength), substr($response, 0, $headerLength)];
}
function base64url(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
function firebaseToken(): string {
    $raw = getenv('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!$raw) throw new RuntimeException('FIREBASE_SERVICE_ACCOUNT_JSON is missing');
    $account = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if (empty($account['client_email']) || empty($account['private_key'])) throw new RuntimeException('Invalid Firebase service account');
    $now = time();
    $header = base64url(json_encode(['alg'=>'RS256','typ'=>'JWT']));
    $claims = base64url(json_encode(['iss'=>$account['client_email'], 'sub'=>$account['client_email'],
        'aud'=>'https://oauth2.googleapis.com/token', 'iat'=>$now, 'exp'=>$now + 3600,
        'scope'=>'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email']));
    $message = $header . '.' . $claims;
    if (!openssl_sign($message, $signature, $account['private_key'], OPENSSL_ALGO_SHA256)) throw new RuntimeException('Unable to sign Firebase assertion');
    $assertion = $message . '.' . base64url($signature);
    [$status, $body] = request('https://oauth2.googleapis.com/token', 'POST', http_build_query([
        'grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion'=>$assertion
    ]), ['Content-Type: application/x-www-form-urlencoded']);
    $result = json_decode($body, true);
    if ($status !== 200 || empty($result['access_token'])) throw new RuntimeException('Firebase OAuth failed: HTTP ' . $status);
    return $result['access_token'];
}
function db(string $path, string $token, string $method = 'GET', ?array $value = null, array $extraHeaders = []): array {
    $headers = array_merge(['Authorization: Bearer ' . $token, 'Content-Type: application/json'], $extraHeaders);
    return request('https://kitphanmmo-default-rtdb.firebaseio.com/' . $path . '.json', $method,
        $value === null ? null : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $headers);
}
function telegram(string $message): void {
    $bot = getenv('TELEGRAM_BOT_TOKEN'); $chat = getenv('TELEGRAM_CHAT_ID');
    if (!$bot || !$chat) { error_log('Telegram variables missing'); return; }
    [$status, $body] = request('https://api.telegram.org/bot' . rawurlencode($bot) . '/sendMessage', 'POST',
        json_encode(['chat_id'=>$chat, 'text'=>$message], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ['Content-Type: application/json']);
    if ($status !== 200 || !(json_decode($body, true)['ok'] ?? false)) error_log('Telegram send failed: HTTP ' . $status);
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond(405, ['success'=>false, 'message'=>'Method not allowed']);
$secret = getenv('SEPAY_WEBHOOK_SECRET');
if (!$secret) respond(503, ['success'=>false, 'message'=>'Webhook secret not configured']);
$payload = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_SEPAY_SIGNATURE'] ?? '';
$timestamp = $_SERVER['HTTP_X_SEPAY_TIMESTAMP'] ?? '';
if ($timestamp === '' || $signature === '' || !hash_equals('sha256=' . hash_hmac('sha256', $timestamp . '.' . $payload, $secret), $signature)) {
    respond(401, ['success'=>false, 'message'=>'Invalid signature']);
}
$data = json_decode($payload, true);
if (!is_array($data)) respond(400, ['success'=>false, 'message'=>'Invalid JSON']);
$transactionId = $data['id'] ?? null;
$amount = $data['transferAmount'] ?? null;
$content = $data['content'] ?? null;
if ((!is_int($transactionId) && !is_string($transactionId)) || !preg_match('/^[a-zA-Z0-9_-]{1,80}$/', (string)$transactionId)
    || !is_numeric($amount) || !is_string($content) || !preg_match('/\bNAP\s+([a-zA-Z0-9_]+)\b/i', $content, $matches)) {
    respond(200, ['success'=>true, 'ignored'=>true]);
}
$amount = (float)$amount;
if (!is_finite($amount) || $amount <= 0 || $amount != floor($amount) || $amount > 1000000000) respond(200, ['success'=>true, 'ignored'=>true]);
if (isset($data['transferType']) && $data['transferType'] !== 'in') respond(200, ['success'=>true, 'ignored'=>true]);
$username = strtolower($matches[1]);
$txKey = 'sepay_' . $transactionId;
try {
    $token = firebaseToken();
    $userPath = 'users/' . rawurlencode($username);
    // Atomic compare-and-swap of the entire user record: balance, totalDeposited and transaction marker change together.
    for ($attempt = 0; $attempt < 8; $attempt++) {
        [$status, $body, $responseHeaders] = db($userPath, $token, 'GET', null, ['X-Firebase-ETag: true']);
        if ($status !== 200) throw new RuntimeException('Firebase read failed: HTTP ' . $status);
        $user = json_decode($body, true);
        if (!is_array($user)) respond(200, ['success'=>true, 'ignored'=>'user_not_found']);
        if (isset($user['sepayProcessed'][$txKey])) respond(200, ['success'=>true, 'duplicate'=>true]);
        if (!preg_match('/^ETag:\s*(.+)$/mi', $responseHeaders, $etagMatch)) throw new RuntimeException('Firebase ETag missing');
        $user['balance'] = (float)($user['balance'] ?? 0) + $amount;
        $user['totalDeposited'] = (float)($user['totalDeposited'] ?? 0) + $amount;
        $user['sepayProcessed'][$txKey] = ['amount'=>$amount, 'at'=>date('c')];
        [$writeStatus] = db($userPath, $token, 'PUT', $user, ['if-match: ' . trim($etagMatch[1])]);
        if ($writeStatus === 412) continue;
        if ($writeStatus !== 200) throw new RuntimeException('Firebase write failed: HTTP ' . $writeStatus);
        // Ancillary history/Telegram failures must never trigger a second balance credit.
        try {
            $deposit = ['id'=>'DEP-' . $transactionId, 'transactionId'=>(string)$transactionId,
                'user'=>$username, 'amount'=>$amount, 'syntax'=>'NAP ' . strtoupper($username),
                'status'=>'Thành công', 'date'=>date('Y-m-d H:i')];
            [$historyStatus] = db('deposits/DEP-' . $transactionId, $token, 'PUT', $deposit);
            if ($historyStatus !== 200) error_log('Deposit history write failed: HTTP ' . $historyStatus);
        } catch (Throwable $e) { error_log('Deposit history error: ' . $e->getMessage()); }
        try {
            telegram("💰 NẠP TIỀN THÀNH CÔNG\n👤 Tài khoản: {$username}\n💵 Số tiền: " . number_format($amount, 0, ',', '.') . "đ\n🧾 Giao dịch SePay: {$transactionId}\n🕒 " . date('d/m/Y H:i:s'));
        } catch (Throwable $e) { error_log('Telegram error: ' . $e->getMessage()); }
        respond(200, ['success'=>true]);
    }
    respond(503, ['success'=>false, 'message'=>'Concurrent update; retry later']);
} catch (Throwable $e) {
    error_log('[sepay_receiver] ' . $e->getMessage());
    respond(503, ['success'=>false, 'message'=>'Temporary processing error']);
}
