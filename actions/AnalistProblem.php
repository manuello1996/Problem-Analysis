<?php declare(strict_types = 1);

namespace Modules\AnalysisProblem\Actions;

use CController;
use CControllerResponseData;
use API;
use CCsrfTokenHelper;
use CUser;

class AnalistProblem extends CController {
    private $logFile;

    protected function init(): void {
        $this->disableCsrfValidation();
        $this->logFile = __DIR__ . '/../logs/debug.log';
        
        if (!is_dir(dirname($this->logFile))) {
            mkdir(dirname($this->logFile), 0777, true);
        }
    }

    private function logDebug($message): void {
        $timestamp = date('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] {$message}" . PHP_EOL;
        file_put_contents($this->logFile, $logMessage, FILE_APPEND);
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function checkInput(): bool {
        $fields = [
            'hostid' => 'required|db hosts.hostid',
            'triggerid' => 'required|db triggers.triggerid'
        ];

        $ret = $this->validateInput($fields);

        if (!$ret) {
            header('Content-Type: application/json');
            echo json_encode([
                'success' => false,
                'error' => ['messages' => ['Invalid input parameters']]
            ]);
            exit();
        }

        return $ret;
    }

    private function getMonthEvents(int $hostid, int $triggerid, int $year, int $month): array {
        // Calcula timestamps do início e fim do mês
        $start_date = mktime(0, 0, 0, $month, 1, $year);
        $end_date = mktime(23, 59, 59, $month + 1, 0, $year);

        try {
            return API::Event()->get([
                'output' => ['eventid', 'clock', 'r_eventid', 'value'],
                'selectAcknowledges' => ['clock', 'userid', 'message'],
                'objectids' => $triggerid,
                'hostids' => $hostid,
                'time_from' => $start_date,
                'time_till' => $end_date,
                'sortfield' => ['clock'],
                'sortorder' => 'DESC'
            ]);
        } catch (\Exception $e) {
            $this->logDebug("Error getting events: " . $e->getMessage());
            return [];
        }
    }

    private function analyzeMonthEvents(array $events): array {
        $total_problems = 0;
        $resolution_times = [];
        $ack_events = 0;
        $acks = [];
        $problem_events = [];

        // Primeiro, vamos coletar todos os eventos PROBLEM
        foreach ($events as $event) {
            if ($event['value'] == TRIGGER_VALUE_TRUE) {
                $problem_events[] = $event;
                $total_problems++;
            }
        }

        // Agora vamos processar cada problema e seus acknowledges
        foreach ($problem_events as $problem) {
            // Procura o evento de resolução correspondente
            foreach ($events as $event) {
                if ($event['eventid'] == $problem['r_eventid']) {
                    $resolution_time = ($event['clock'] - $problem['clock']) / 3600; // Em horas
                    $resolution_times[] = $resolution_time;
                    break;
                }
            }

            // Processa acknowledges
            if (!empty($problem['acknowledges'])) {
                $ack_events++;
                foreach ($problem['acknowledges'] as $ack) {
                    // Busca informações do usuário
                    $users = API::User()->get([
                        'userids' => [$ack['userid']],
                        'output' => ['alias', 'name', 'surname']
                    ]);
                    
                    $username = 'System';  // Default para caso não encontre usuário
                    if (!empty($users)) {
                        $user = $users[0];
                        // Usa nome completo se disponível, senão usa o alias
                        if (!empty($user['name']) || !empty($user['surname'])) {
                            $username = trim($user['name'] . ' ' . $user['surname']);
                        } else {
                            $username = $user['alias'];
                        }
                    }

                    // Se não houver mensagem, usa um texto indicando que é apenas um acknowledge
                    $message = !empty($ack['message']) && trim($ack['message']) !== '' 
                        ? $ack['message'] 
                        : '[No comment] Event acknowledged';

                    $acks[] = [
                        'event_time' => $problem['clock'],
                        'ack_time' => $ack['clock'],
                        'username' => $username,
                        'message' => $message,
                        'has_message' => !empty($ack['message']) && trim($ack['message']) !== ''
                    ];

                    $this->logDebug("Ack info: " . json_encode([
                        'userid' => $ack['userid'],
                        'username' => $username,
                        'message' => $message,
                        'has_message' => !empty($ack['message']) && trim($ack['message']) !== '',
                        'user_data' => $users[0] ?? null
                    ]));
                }
            }
        }

        // Calcula as médias e porcentagens
        $avg_resolution = !empty($resolution_times) ? array_sum($resolution_times) / count($resolution_times) : 0;
        $ack_percentage = $total_problems > 0 ? ($ack_events / $total_problems) * 100 : 0;

        $this->logDebug("Resolution times: " . json_encode([
            'times' => $resolution_times,
            'count' => count($resolution_times),
            'average' => $avg_resolution
        ]));

        return [
            'total_problems' => $total_problems,
            'avg_resolution_time' => round($avg_resolution, 2),
            'ack_events' => $ack_events,
            'ack_percentage' => round($ack_percentage, 2),
            'acks' => $acks
        ];
    }

    protected function doAction(): void {
        try {
            $hostid = (int)$this->getInput('hostid');
            $triggerid = (int)$this->getInput('triggerid');

            // Obtém mês atual e anterior
            $current_date = time();
            $current_month = (int)date('n', $current_date);
            $current_year = (int)date('Y', $current_date);
            
            $prev_month = $current_month == 1 ? 12 : $current_month - 1;
            $prev_year = $current_month == 1 ? $current_year - 1 : $current_year;

            // Analisa eventos dos dois meses
            $current_events = $this->getMonthEvents($hostid, $triggerid, $current_year, $current_month);
            $prev_events = $this->getMonthEvents($hostid, $triggerid, $prev_year, $prev_month);

            $current_stats = $this->analyzeMonthEvents($current_events);
            $prev_stats = $this->analyzeMonthEvents($prev_events);

            // Obtém informações do host e trigger
            $host = API::Host()->get([
                'output' => ['name'],
                'hostids' => $hostid
            ]);

            $trigger = API::Trigger()->get([
                'output' => ['description'],
                'triggerids' => $triggerid
            ]);

            header('Content-Type: application/json');
            echo json_encode([
                'success' => true,
                'data' => [
                    'host' => $host[0]['name'] ?? 'Unknown',
                    'trigger' => $trigger[0]['description'] ?? 'Unknown',
                    'current_month' => [
                        'period' => date('m/Y', $current_date),
                        'stats' => $current_stats
                    ],
                    'previous_month' => [
                        'period' => date('m/Y', mktime(0, 0, 0, $prev_month, 1, $prev_year)),
                        'stats' => $prev_stats
                    ]
                ]
            ]);
        } catch (\Exception $e) {
            $this->logDebug("Error in doAction: " . $e->getMessage());
            header('Content-Type: application/json');
            echo json_encode([
                'success' => false,
                'error' => ['messages' => [$e->getMessage()]]
            ]);
        }
        exit();
    }
} 