import { BOT_SPEED } from '@/constants/bot-speed';
import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE, STOP } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        constructor(...args) {
            super(...args);
            this.ultra_purchase_queue = [];
            this.ultra_purchase_processing = false;
            this.ultra_contract_ids = new Set();
        }

        purchase(contract_type) {
            if (this.speed_mode === BOT_SPEED.ULTRA_FAST) {
                return this.enqueueUltraPurchase(contract_type);
            }

            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }
        enqueueUltraPurchase(contract_type) {
            this.ultra_purchase_queue.push(contract_type);
            this.processUltraPurchaseQueue();
            return Promise.resolve();
        }

        async processUltraPurchaseQueue() {
            if (this.ultra_purchase_processing) return;

            this.ultra_purchase_processing = true;
            while (this.ultra_purchase_queue.length && !api_base.is_stopping) {
                const contract_type = this.ultra_purchase_queue.shift();
                try {
                    await this.executeUltraPurchase(contract_type);
                } catch (error) {
                    this.observer.emit('Error', error);
                }
            }
            this.ultra_purchase_processing = false;
        }

        waitForUltraProposals() {
            if (this.store.getState().proposalsReady) {
                return Promise.resolve(true);
            }

            return new Promise(resolve => {
                const unsubscribe = this.store.subscribe(() => {
                    const { proposalsReady, scope } = this.store.getState();
                    if (proposalsReady) {
                        unsubscribe();
                        resolve(true);
                    } else if (scope === STOP) {
                        unsubscribe();
                        resolve(false);
                    }
                });
            });
        }

        async executeUltraPurchase(contract_type) {
            let action;
            let ask_price;

            if (this.is_proposal_subscription_required) {
                if (!(await this.waitForUltraProposals())) return;

                const { id, askPrice } = this.selectProposal(contract_type);
                action = () => api_base.api.send({ buy: id, price: askPrice });
                ask_price = askPrice;
            } else {
                action = () => api_base.api.send(tradeOptionToBuy(contract_type, this.tradeOptions));
                ask_price = this.tradeOptions.amount;
            }

            contractStatus({
                id: 'contract.purchase_sent',
                data: ask_price,
            });

            const response = await doUntilDone(action);
            const { buy } = response;

            if (!buy) {
                throw new Error('Ultra-fast purchase returned no contract');
            }

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_received',
                data: buy.transaction_id,
                buy,
            });
            this.ultra_contract_ids.add(String(buy.contract_id));
            this.store.dispatch(purchaseSuccessful());
            broadcastContract({
                accountID: api_base.account_info.loginid,
                ...buy,
                transaction_ids: { buy: buy.transaction_id },
                is_sold: false,
            });

            log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
            info({
                accountID: this.accountInfo.loginid,
                totalRuns: this.updateAndReturnTotalRuns(),
                transaction_ids: { buy: buy.transaction_id },
                contract_type,
                buy_price: buy.buy_price,
            });

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }
        }

        clearUltraPurchaseQueue() {
            this.ultra_purchase_queue = [];
            this.ultra_contract_ids.clear();
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
