document.addEventListener('DOMContentLoaded', () => {
    class ExecuteItems {
        constructor() {
            this.CSRF_TOKEN_NAME = '_csrf_token';
            this.form = this.findFormWithCsrfToken();
            this.init();
        }

        findFormWithCsrfToken() {
            for (let form of document.forms) {
                if (form[this.CSRF_TOKEN_NAME]) {
                    return form;
                }
            }
            
            const tokenInput = document.querySelector(`input[name="${this.CSRF_TOKEN_NAME}"]`);
            if (tokenInput) {
                return tokenInput.closest('form') || document.forms[0];
            }

            return document.forms[0];
        }

        init() {
            // Adiciona os botões inicialmente
            this.addAnalyticsButton();
            
            // Observer para mudanças no DOM
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    // Verifica se há mudanças relevantes para os botões Analytics
                    if (mutation.target.classList && 
                        (mutation.target.classList.contains('flickerfreescreen') ||
                         mutation.target.classList.contains('list-table') ||
                         mutation.target.tagName === 'TBODY')) {
                        this.addAnalyticsButton();
                    }

                    // Mantém o observer para o modal de execução
                    const dialogues = document.querySelectorAll('.overlay-dialogue[data-dialogueid="host_edit"]');
                    dialogues.forEach(dialogue => {
                        if (dialogue.querySelector('.overlay-dialogue-footer') && 
                            !dialogue.querySelector('.js-execute-all-items')) {
                            this.addExecuteButton(dialogue);
                        }
                    });
                });
            });

            // Observa o corpo do documento para mudanças
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });

            // Adiciona um listener para o evento específico do Zabbix de atualização da tela
            document.addEventListener('zbx_reload', () => {
                this.addAnalyticsButton();
            });
        }

        addExecuteButton(dialogNode) {
            const footer = dialogNode.querySelector('.overlay-dialogue-footer');
            if (!footer) return;

            if (footer.querySelector('.js-execute-all-items')) return;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-alt js-execute-all-items';
            button.textContent = t('Execute all items');

            const cancelButton = footer.querySelector('.js-cancel');
            if (cancelButton) {
                footer.insertBefore(button, cancelButton);
            } else {
                footer.insertBefore(button, footer.firstChild);
            }

            button.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    button.disabled = true;
                    button.textContent = t('Executing...');
                    await this.executeAllItems(dialogNode);
                } catch (error) {
                    console.error('Execute error:', error);
                    this.showMessage(error.message, false);
                } finally {
                    button.disabled = false;
                    button.textContent = t('Execute all items');
                }
            });
        }

        async showAnalyticsModal(hostid, triggerid, hostName, triggerName) {
            try {
                const formData = new URLSearchParams();
                formData.append('hostid', hostid);
                formData.append('triggerid', triggerid);

                const response = await fetch('zabbix.php?action=analistproblem.list', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: formData.toString()
                });

                const responseText = await response.text();
                let result;
                try {
                    result = JSON.parse(responseText);
                } catch (e) {
                    console.error('Response text:', responseText);
                    throw new Error('Invalid JSON response from server');
                }
                
                if (!result.success) {
                    throw new Error(result.error?.messages?.[0] || 'Unknown error');
                }

                const data = result.data;
                
                // Cria o conteúdo do modal
                const content = this.createModalContent(data);

                // Cria e exibe o modal do Zabbix
                overlayDialogue({
                    'title': `Problem Analysis - ${data.host}`,
                    'content': content,
                    'class': 'modal-popup modal-popup-generic',
                    'buttons': [{
                        'title': t('Close'),
                        'class': 'btn-alt js-close',
                        'action': function() {}
                    }],
                    'dialogueid': 'analyticsProblemModal'
                });

            } catch (error) {
                console.error('Error fetching analytics:', error);
                this.showMessage(error.message || 'Error loading analytics', false);
            }
        }

        createModalContent(data) {
            const current = data.current_month;
            const previous = data.previous_month;

            // Função para formatar o tempo em horas e minutos
            const formatResolutionTime = (hours) => {
                if (hours === 0) return '0m';
                
                const h = Math.floor(hours);
                const m = Math.round((hours - h) * 60);
                
                if (h === 0) return `${m}m`;
                if (m === 0) return `${h}h`;
                return `${h}h ${m}m`;
            };

            // Função para criar indicador de comparação
            const createComparison = (currentValue, previousValue, inverseColors = false) => {
                let diff = currentValue - previousValue;
                
                // Se não houve mudança, não mostra indicador
                if (diff === 0) return '';
                
                const isPositive = diff > 0;
                const arrow = isPositive ? '↑' : '↓';
                
                // Se inverseColors for true, vermelho é bom (redução) e verde é ruim (aumento)
                let colorClass;
                if (inverseColors) {
                    colorClass = isPositive ? 'analist-problem-worse' : 'analist-problem-better';
                } else {
                    colorClass = isPositive ? 'analist-problem-better' : 'analist-problem-worse';
                }

                // Casos especiais de zero
                if (previousValue === 0 && currentValue > 0) {
                    return `<span class="analist-problem-indicator ${colorClass}">
                        ${arrow} NEW
                    </span>`;
                }
                if (currentValue === 0 && previousValue > 0) {
                    return `<span class="analist-problem-indicator ${colorClass}">
                        ${arrow} CLEARED
                    </span>`;
                }

                // Caso normal, calcula a porcentagem
                const percentage = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
                
                return `<span class="analist-problem-indicator ${colorClass}">
                    ${arrow} ${Math.abs(percentage).toFixed(1)}%
                </span>`;
            };

            // Cria a tabela de comparação
            const comparisonTable = `
                <div class="analist-problem-dashboard-container">
                    <div class="analist-problem-dashboard-row">
                        <div class="analist-problem-dashboard-cell analist-problem-header-cell"></div>
                        <div class="analist-problem-dashboard-cell analist-problem-header-cell">${t('Current Month')} (${current.period})</div>
                        <div class="analist-problem-dashboard-cell analist-problem-header-cell">${t('Previous Month')} (${previous.period})</div>
                    </div>
                    <div class="analist-problem-dashboard-row">
                        <div class="analist-problem-dashboard-cell">${t('Total Problems')}</div>
                        <div class="analist-problem-dashboard-cell">
                            ${current.stats.total_problems}
                            ${createComparison(current.stats.total_problems, previous.stats.total_problems, true)}
                        </div>
                        <div class="analist-problem-dashboard-cell">${previous.stats.total_problems}</div>
                    </div>
                    <div class="analist-problem-dashboard-row">
                        <div class="analist-problem-dashboard-cell">${t('Avg Resolution Time')}</div>
                        <div class="analist-problem-dashboard-cell">
                            ${formatResolutionTime(current.stats.avg_resolution_time)}
                            ${createComparison(current.stats.avg_resolution_time, previous.stats.avg_resolution_time, true)}
                        </div>
                        <div class="analist-problem-dashboard-cell">${formatResolutionTime(previous.stats.avg_resolution_time)}</div>
                    </div>
                    <div class="analist-problem-dashboard-row">
                        <div class="analist-problem-dashboard-cell">${t('Events with ACK')}</div>
                        <div class="analist-problem-dashboard-cell">
                            ${current.stats.ack_events}
                            ${createComparison(current.stats.ack_events, previous.stats.ack_events)}
                        </div>
                        <div class="analist-problem-dashboard-cell">${previous.stats.ack_events}</div>
                    </div>
                    <div class="analist-problem-dashboard-row">
                        <div class="analist-problem-dashboard-cell">${t('ACK Percentage')}</div>
                        <div class="analist-problem-dashboard-cell">
                            ${current.stats.ack_percentage}%
                            ${createComparison(current.stats.ack_percentage, previous.stats.ack_percentage)}
                        </div>
                        <div class="analist-problem-dashboard-cell">${previous.stats.ack_percentage}%</div>
                    </div>
                </div>`;

            // Cria as seções de acknowledges com paginação
            const createAckSection = (acks, title) => {
                if (!acks || acks.length === 0) return '';
                
                const itemsPerPage = 2;
                const totalPages = Math.ceil(acks.length / itemsPerPage);
                
                const createPagination = (currentPage, totalPages, sectionId) => {
                    if (totalPages <= 1) return '';
                    
                    let buttons = '';
                    for (let i = 1; i <= totalPages; i++) {
                        buttons += `
                            <button type="button" 
                                class="analist-problem-page-btn ${i === currentPage ? 'analist-problem-page-active' : ''}"
                                data-page="${i}" 
                                data-section="${sectionId}"
                                onclick="window.analistProblem.changePage(${i}, '${sectionId}')">
                                ${i}
                            </button>`;
                    }
                    
                    return `<div class="analist-problem-pagination">${buttons}</div>`;
                };

                const sectionId = `ack-section-${title.replace(/\s+/g, '-').toLowerCase()}`;
                const acksList = acks.map((ack, index) => `
                    <div class="analist-problem-ack-item" data-page="${Math.floor(index / itemsPerPage) + 1}" style="${index >= itemsPerPage ? 'display:none;' : ''}">
                        <div class="analist-problem-ack-header">
                            <div class="analist-problem-ack-info">
                                <span class="analist-problem-ack-time">
                                    ${new Date(ack.event_time * 1000).toLocaleString()}
                                </span>
                                <span class="analist-problem-ack-user">
                                    <strong>${t('By')}:</strong> ${ack.username || 'System'}
                                </span>
                            </div>
                        </div>
                        <div class="analist-problem-ack-message ${!ack.has_message ? 'analist-problem-no-comment' : ''}">
                            ${ack.message}
                        </div>
                    </div>
                `).join('');

                return `
                    <div class="analist-problem-ack-section" id="${sectionId}">
                        <h4>${title}</h4>
                        <div class="analist-problem-ack-list">${acksList}</div>
                        ${createPagination(1, totalPages, sectionId)}
                    </div>`;
            };

            const currentAcks = createAckSection(current.stats.acks, t('Current Month Acknowledges'));
            const previousAcks = createAckSection(previous.stats.acks, t('Previous Month Acknowledges'));

            // Adiciona estilos CSS inline
            const styles = `
                <style>
                    .analist-problem-dashboard-container {
                        margin: 20px 0;
                        border: 1px solid #ddd;
                    }
                    .analist-problem-dashboard-row {
                        display: grid;
                        grid-template-columns: 2fr 1fr 1fr;
                        border-bottom: 1px solid #ddd;
                    }
                    .analist-problem-dashboard-row:last-child {
                        border-bottom: none;
                    }
                    .analist-problem-dashboard-cell {
                        padding: 8px;
                        border-right: 1px solid #ddd;
                        position: relative;
                    }
                    .analist-problem-dashboard-cell:last-child {
                        border-right: none;
                    }
                    .analist-problem-header-cell {
                        font-weight: bold;
                    }
                    .analist-problem-indicator {
                        display: inline-block;
                        margin-left: 8px;
                        font-weight: bold;
                        font-size: 0.9em;
                    }
                    .analist-problem-better {
                        color: #4CAF50;
                    }
                    .analist-problem-worse {
                        color: #F44336;
                    }
                    .analist-problem-ack-section {
                        margin-top: 20px;
                    }
                    .analist-problem-ack-item {
                        margin: 10px 0;
                        padding: 10px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                    }
                    .analist-problem-ack-header {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 5px;
                        color: #666;
                    }
                    .analist-problem-ack-message {
                        white-space: pre-wrap;
                        padding: 8px;
                        background: #f8f8f8;
                        border-radius: 4px;
                        margin-top: 5px;
                    }
                    .analist-problem-no-comment {
                        color: #666;
                        font-style: italic;
                        background: #f0f0f0;
                    }
                    .analist-problem-ack-info {
                        display: flex;
                        flex-direction: column;
                        gap: 5px;
                    }
                    .analist-problem-ack-time {
                        color: #666;
                    }
                    .analist-problem-ack-user {
                        color: #1e87e3;
                        font-weight: 500;
                    }
                    .analist-problem-pagination {
                        margin-top: 10px;
                        display: flex;
                        justify-content: center;
                        gap: 5px;
                    }
                    .analist-problem-page-btn {
                        padding: 5px;
                        border: 1px solid #ddd;
                        background: #f8f8f8;
                        cursor: pointer;
                        border-radius: 3px;
                    }
                    .analist-problem-page-btn:hover {
                        background: #e8e8e8;
                    }
                    .analist-problem-page-active {
                        background: #1e87e3;
                        color: white;
                        border-color: #1e87e3;
                    }
                    .overlay-dialogue[data-dialogueid="analyticsProblemModal"] {
                        top: 100px !important;
                    }
                </style>`;

            // Adiciona a função de paginação ao objeto window
            window.analistProblem = {
                changePage: function(page, sectionId) {
                    const section = document.getElementById(sectionId);
                    if (!section) return;

                    // Atualiza os itens visíveis
                    const items = section.querySelectorAll('.analist-problem-ack-item');
                    items.forEach(item => {
                        const itemPage = parseInt(item.dataset.page);
                        item.style.display = itemPage === page ? '' : 'none';
                    });

                    // Atualiza os botões de paginação
                    const buttons = section.querySelectorAll('.analist-problem-page-btn');
                    buttons.forEach(btn => {
                        const btnPage = parseInt(btn.dataset.page);
                        btn.classList.toggle('analist-problem-page-active', btnPage === page);
                    });
                }
            };

            return styles + `
                <div class="analist-problem-content">
                    <h3>${t('Problem')}: ${data.trigger}</h3>
                    ${comparisonTable}
                    ${currentAcks}
                    ${previousAcks}
                </div>`;
        }

        showMessage(message, success = true) {
            if (typeof window.messages !== 'undefined') {
                if (success) {
                    window.messages.addSuccess(message);
                } else {
                    window.messages.addError(message);
                }
            } else {
                alert(message);
            }
        }

        addAnalyticsButton() {
            const flickerfreescreen = document.querySelector('.flickerfreescreen');
            if (!flickerfreescreen) return;

            const tables = flickerfreescreen.querySelectorAll('table.list-table');
            tables.forEach(table => {
                const tbody = table.querySelector('tbody');
                if (!tbody) return;

                const rows = tbody.querySelectorAll('tr:not(.timeline-axis):not(.timeline-td)');
                rows.forEach(row => {
                    // Verifica se a linha não é uma linha de tempo e se tem a coluna Problem
                    if (row.querySelector('.js-analytics-button') || 
                        !row.querySelector('.problem-expand-td')) return;

                    // Procura os elementos com data-menu-popup
                    const hostElement = row.querySelector('[data-menu-popup*="hostid"]');
                    const triggerElement = row.querySelector('[data-menu-popup*="triggerid"]');
                    
                    let hostid = null;
                    let triggerid = null;
                    let hostName = '';
                    let triggerName = '';

                    if (hostElement) {
                        try {
                            const hostData = JSON.parse(hostElement.getAttribute('data-menu-popup'));
                            hostid = hostData.data.hostid;
                            hostName = hostElement.textContent.trim();
                        } catch (e) {
                            console.warn('Erro ao parsear hostid:', e);
                        }
                    }

                    if (triggerElement) {
                        try {
                            const triggerData = JSON.parse(triggerElement.getAttribute('data-menu-popup'));
                            triggerid = triggerData.data.triggerid;
                            triggerName = triggerElement.textContent.trim();
                        } catch (e) {
                            console.warn('Erro ao parsear triggerid:', e);
                        }
                    }

                    // Verifica se já existe um botão Analytics nesta linha
                    if (!row.querySelector('.js-analytics-button')) {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'btn-alt js-analytics-button';
                        button.textContent = 'Analytics';
                        
                        const td = document.createElement('td');
                        td.appendChild(button);
                        row.appendChild(td);

                        button.addEventListener('click', () => {
                            if (hostid && triggerid) {
                                this.showAnalyticsModal(hostid, triggerid, hostName, triggerName);
                            } else {
                                this.showMessage(t('Could not find host or trigger information'), false);
                            }
                        });
                    }
                });
            });
        }

        getHostId(dialogNode) {
            const urlParams = new URLSearchParams(window.location.search);
            let hostid = urlParams.get('hostid');

            if (!hostid) {
                const hostIdElement = dialogNode.querySelector('[data-hostid]');
                if (hostIdElement) {
                    hostid = hostIdElement.dataset.hostid;
                }
            }

            return hostid;
        }

        async executeAllItems(dialogNode) {
            try {
                const hostId = this.getHostId(dialogNode);
                if (!hostId) {
                    throw new Error(t('Host ID not found'));
                }

                const response = await fetch(`zabbix.php?action=hostitems.list&hostid=${hostId}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                const result = await response.json();
                

                if (!result.success || !result.data?.itemids) {
                    throw new Error(result.error?.messages?.[0] || t('Failed to get items'));
                }

                let token = null;
                
                if (window.view?.token?._csrf_token) {
                    token = window.view.token._csrf_token;
                }
                else if (window[this.CSRF_TOKEN_NAME]) {
                    token = window[this.CSRF_TOKEN_NAME];
                }
                else {
                    const scripts = document.getElementsByTagName('script');
                    for (let script of scripts) {
                        if (script.textContent.includes('var _csrf_token')) {
                            const match = script.textContent.match(/var\s+_csrf_token\s*=\s*['"]([^'"]+)['"]/);
                            if (match) {
                                token = match[1];
                                break;
                            }
                        }
                    }
                }


                

                const itemExecuteResponse = await fetch('zabbix.php?action=item.execute', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify({
                        context: 'host',
                        itemids: result.data.itemids,
                        _csrf_token: result.data._csrf_token
                    })
                });

                const executeResult = await itemExecuteResponse.json();
                

                if (executeResult.success) {
                    this.showMessage(t(`Successfully executed ${result.data.count} items`), true);
                    setTimeout(() => {
                        overlayDialogueDestroy(dialogNode.id);
                    }, 1000);
                } else {
                    throw new Error(executeResult.error?.messages?.[0] || t('Failed to execute items'));
                }

            } catch (error) {
                console.error('Execute error:', error);
                this.showMessage(error.message, false);
            }
        }

        async post(url, data) {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(data)
            });

            return response.json();
        }
    }

    new ExecuteItems();
}); 