import { localize } from '@deriv-com/translations';
import { getContractTypeOptions } from '../../../shared';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.purchase = {
    init() {
        this.jsonInit(this.definition());

        // Ensure one of this type per statement-stack
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [['', '']],
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('This block purchases contract of a specified type.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    mutationToDom() {
        const container = document.createElement('mutation');
        const is_hedging = this.getFieldValue('PURCHASE_LIST') === 'hedging';
        container.setAttribute('hedging', is_hedging);
        if (is_hedging) {
            container.setAttribute('higher_offset', this.getFieldValue('HIGHER_OFFSET') || '1');
            container.setAttribute('lower_offset', this.getFieldValue('LOWER_OFFSET') || '1');
        }
        return container;
    },
    domToMutation(xmlElement) {
        const is_hedging = xmlElement.getAttribute('hedging') === 'true';
        if (is_hedging) {
            this.updateHedgingInputs(true);
            this.setFieldValue(xmlElement.getAttribute('higher_offset') || '1', 'HIGHER_OFFSET');
            this.setFieldValue(xmlElement.getAttribute('lower_offset') || '1', 'LOWER_OFFSET');
        }
    },
    meta() {
        return {
            display_name: localize('Purchase'),
            description: localize(
                'Use this block to purchase the specific contract you want. You may add multiple Purchase blocks together with conditional blocks to define your purchase conditions. This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('buy'),
        };
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }

        if (event.type === window.Blockly.Events.BLOCK_CREATE && event.ids.includes(this.id)) {
            this.updateBarrierOffsetInput();
            this.populatePurchaseList(event);
        } else if (event.type === window.Blockly.Events.BLOCK_CHANGE) {
            if (event.name === 'TYPE_LIST' || event.name === 'TRADETYPE_LIST') {
                this.updateBarrierOffsetInput();
                this.populatePurchaseList(event);
            }
        } else if (event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart && event.blockId === this.id) {
            const purchase_type_list = this.getField('PURCHASE_LIST');
            const purchase_options = purchase_type_list.menuGenerator_; // eslint-disable-line

            if (purchase_options[0][0] === '') {
                this.populatePurchaseList(event);
            }
        }
    },
    updateBarrierOffsetInput() {
        const trade_definition_block = this.workspace.getTradeDefinitionBlock();
        if (!trade_definition_block) return;

        const trade_type_block = trade_definition_block.getChildByType('trade_definition_tradetype');
        const trade_type = trade_type_block?.getFieldValue('TRADETYPE_LIST');
        const contract_type_block = trade_definition_block.getChildByType('trade_definition_contracttype');
        const contract_type = contract_type_block?.getFieldValue('TYPE_LIST');
        const is_higherlower = trade_type === 'higherlower' && contract_type === 'both';

        if (is_higherlower && !this.getInput('BARRIER_OFFSET')) {
            this.appendValueInput('BARRIER_OFFSET')
                .setCheck(null)
                .appendField('barrier offset:');
        } else if (!is_higherlower && this.getInput('BARRIER_OFFSET')) {
            this.removeInput('BARRIER_OFFSET', true);
        }

        if (is_higherlower && !this.getInput('HIGHER_OFFSET')) {
            this.appendDummyInput('HIGHER_LABEL').appendField(localize('Higher offset:'));
            this.appendValueInput('HIGHER_OFFSET')
                .setCheck('Number')
                .appendField(new window.Blockly.FieldNumber(1, 0), 'HIGHER_OFFSET');
            this.appendDummyInput('LOWER_LABEL').appendField(localize('Lower offset:'));
            this.appendValueInput('LOWER_OFFSET')
                .setCheck('Number')
                .appendField(new window.Blockly.FieldNumber(1, 0), 'LOWER_OFFSET');
        } else if (!is_higherlower && this.getInput('HIGHER_OFFSET')) {
            this.removeInput('HIGHER_LABEL', true);
            this.removeInput('HIGHER_OFFSET', true);
            this.removeInput('LOWER_LABEL', true);
            this.removeInput('LOWER_OFFSET', true);
        }
    },
    updateHedgingInputs(show) {
        if (show) {
            if (!this.getInput('HIGHER_OFFSET')) {
                this.appendDummyInput('HIGHER_LABEL').appendField(localize('Higher offset:'));
                this.appendValueInput('HIGHER_OFFSET')
                    .setCheck('Number')
                    .appendField(new window.Blockly.FieldNumber(1, 0), 'HIGHER_OFFSET');
                this.appendDummyInput('LOWER_LABEL').appendField(localize('Lower offset:'));
                this.appendValueInput('LOWER_OFFSET')
                    .setCheck('Number')
                    .appendField(new window.Blockly.FieldNumber(1, 0), 'LOWER_OFFSET');
            }
        } else {
            this.removeInput('HIGHER_LABEL', true);
            this.removeInput('HIGHER_OFFSET', true);
            this.removeInput('LOWER_LABEL', true);
            this.removeInput('LOWER_OFFSET', true);
        }
    },
    populatePurchaseList(event) {
        const trade_definition_block = this.workspace.getTradeDefinitionBlock();

        if (trade_definition_block) {
            const trade_type_block = trade_definition_block.getChildByType('trade_definition_tradetype');
            const trade_type = trade_type_block.getFieldValue('TRADETYPE_LIST');
            const contract_type_block = trade_definition_block.getChildByType('trade_definition_contracttype');
            const contract_type = contract_type_block.getFieldValue('TYPE_LIST');
            const purchase_type_list = this.getField('PURCHASE_LIST');
            const purchase_type = purchase_type_list.getValue();
            const contract_type_options = getContractTypeOptions(contract_type, trade_type);

            // Add hedging option for higherlower with both contract type
            if (trade_type === 'higherlower' && contract_type === 'both') {
                contract_type_options.unshift([localize('Hedging (Both Higher and Lower)'), 'hedging']);
            }

            purchase_type_list.updateOptions(contract_type_options, {
                default_value: purchase_type,
                event_group: event.group,
                should_pretend_empty: true,
            });

            // Update hedging inputs based on selection
            const is_hedging = purchase_type === 'hedging';
            this.updateHedgingInputs(is_hedging);
        }
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.purchase = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');

    // Handle hedging mode - purchase both CALL and PUT simultaneously
    if (purchaseList === 'hedging') {
        const higherOffset = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'HIGHER_OFFSET',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
        const lowerOffset = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'LOWER_OFFSET',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';

        const code = `Bot.purchase('CALL', ${higherOffset});\nBot.purchase('PUT', -${lowerOffset});\n`;
        return code;
    }

    const barrierOffset = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'BARRIER_OFFSET',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    );

    if (barrierOffset) {
        const code = `Bot.purchase('${purchaseList}', ${barrierOffset});\n`;
        return code;
    }

    const code = `Bot.purchase('${purchaseList}');\n`;
    return code;
};
