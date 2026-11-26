<?php
/**
 * RETIRED in KIT PHAN MMO Premium V5.3.
 * DO NOT redeploy the older PHP handler that used to increase users.balance.
 * All LIVE bank webhooks must use the distinct Node.js record-only endpoint
 * /api/sepay-live-webhook after independent configuration and verification.
 * NO legacy wallet crediting is permitted from this endpoint.
 */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}
http_response_code(410);
echo json_encode(['success' => false, 'message' => 'Legacy PHP wallet crediting retired; live deposit intake is not active']);
