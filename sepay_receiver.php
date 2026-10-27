<?php
header('Content-Type: application/json; charset=utf-8');

$json = file_get_contents('php://input');
$data = json_decode($json, true);

if ($data && isset($data['transferAmount']) && isset($data['content'])) {
    $transferAmount = floatval($data['transferAmount']);
    $content        = trim($data['content']);

    $username = '';
    if (preg_match('/NAP\s+([a-zA-Z0-9_]+)/i', $content, $matches)) {
        $username = strtolower(trim($matches[1]));
    }

    if (!empty($username) && $transferAmount > 0) {
        $firebaseDbUrl = "https://kitphanmmo-default-rtdb.firebaseio.com";

        $userUrl = $firebaseDbUrl . "/users/" . $username . ".json";
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $userUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $userJson = curl_exec($ch);
        curl_close($ch);

        $userData = json_decode($userJson, true);

        if ($userData) {
            $currentBalance   = floatval($userData['balance'] ?? 0);
            $currentDeposited = floatval($userData['totalDeposited'] ?? 0);

            $newBalance   = $currentBalance + $transferAmount;
            $newDeposited = $currentDeposited + $transferAmount;

            $updateData = json_encode([
                'balance'        => $newBalance,
                'totalDeposited' => $newDeposited
            ]);

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $userUrl);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "PATCH");
            curl_setopt($ch, CURLOPT_POSTFIELDS, $updateData);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_exec($ch);
            curl_close($ch);

            $depositId  = "DEP-" . rand(100000, 900000);
            $depositUrl = $firebaseDbUrl . "/deposits/" . $depositId . ".json";
            
            $timeStr = date('Y-m-d H:i');
            $depositData = json_encode([
                'id'     => $depositId,
                'user'   => $username,
                'amount' => $transferAmount,
                'syntax' => "NAP " . strtoupper($username),
                'status' => 'Thành công',
                'date'   => $timeStr
            ]);

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $depositUrl);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "PUT");
            curl_setopt($ch, CURLOPT_POSTFIELDS, $depositData);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_exec($ch);
            curl_close($ch);
        }
    }

    echo json_encode(['success' => true]);
    exit();
}

echo json_encode(['success' => false, 'message' => 'Invalid data']);
?>
