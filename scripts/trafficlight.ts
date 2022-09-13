/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint no-constant-condition: [ "error", { "checkLoops": false } ], prefer-template: 1 */

import {chromium} from 'playwright';
import type {Page} from 'playwright';
import fetch from 'node-fetch';
import * as crypto from 'crypto';
import * as process from 'process';

async function startClient() {
    const browser = await chromium.launch({
        executablePath: "/usr/bin/chromium-browser",
        headless: false,
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    return {browser, page};
}

async function registerAsClient(trafficlightUrl: string, uuid: string) {
    console.log('Registering trafficlight client');

    const data = JSON.stringify({
        type: 'element-web',
        version: 'UNKNOWN', // at some point we need to know this, but for now it's hard to determine.
    });
    const target = `${trafficlightUrl}/client/${uuid}/register`;
    const response = await fetch(target, { method: 'POST', body: data, headers: { 'Content-Type': 'application/json' } })
    if (response.status != 200) {
        throw new Error(`Unable to register client, got ${ response.status } from server`);
    } else {
        console.log(`Registered to trafficlight as ${uuid}`);
    }
}

async function startRegisterLoop(trafficlightUrl: string, elementUrl: string) {
    while (true) {
        const uuid = crypto.randomUUID();
        await registerAsClient(trafficlightUrl, uuid);
        const clientBaseUrl = `${trafficlightUrl}/client/${encodeURIComponent(uuid)}`;
        const {page, browser} = await startClient();
        try {
            await pollLoop(page, clientBaseUrl, elementUrl);
        } catch (err) {
            console.log(err);
            console.log("------------------ stalling process");
            await new Promise(r => {});
        }
    }
}


const trafficlightUrl = process.env.TRAFFICLIGHT_URL || 'http://127.0.0.1:5000';
const elementUrl = process.env.ELEMENT_WEB_URL || 'http://127.0.0.1:8080';

startRegisterLoop(trafficlightUrl, elementUrl);

type PollData = {
    action: string;
    data: Record<string, any>
}
/*
 * Core loop of the trafficlight client.
 * We call it recurse() and loop via recursion rather than traditional looping
 * as cypress works in a native promise like way, tasks are enqueued for later work/matching.
 *
 * Each cycle pulls one request from the trafficlight server and acts on it.
 */
async function pollLoop(page: Page, clientBaseUrl: string, elementUrl: string): Promise<void> {
    const pollUrl = `${clientBaseUrl}/poll`;
    const respondUrl = `${clientBaseUrl}/respond`;

    let shouldExit = false;
    while (!shouldExit) {
        const pollResponse = await fetch(pollUrl);
        if (pollResponse.status !== 200) {
            throw new Error('poll failed with ' + pollResponse.status);
        }
        const pollData = await pollResponse.json() as PollData;
        console.log(' * running action ' + pollData.action);
        if (pollData.action === 'exit') {
            shouldExit = true;
        } else {
            let result : string | undefined;
            try {
                result = await runAction(pollData.action, pollData.data, page, elementUrl);
            } catch (err) {
                console.error(err);
                result = 'error';
            }
            if (result) {
                const respondResponse = await fetch(respondUrl, {
                    method: 'POST',
                    body: JSON.stringify({
                        response: result
                    }),
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });
                if (respondResponse.status !== 200) {
                    throw new Error('respond failed with ' + respondResponse.status);
                }
            }
        }
    }
}

async function runAction(action: string, data: Record<string, any>, page: Page, elementUrl: string): Promise<string | undefined> {
    async function openApp(hash: string) {
        const url = new URL(elementUrl);
        url.hash = hash;
        await page.goto(url.toString());
    }

    switch (action) {
        case 'register':
            await openApp(`#/register`);
            await page.locator('.mx_ServerPicker_change').click();
            //page.locator('.mx_ServerPickerDialog_continue').should('be.visible');
            await page.locator('.mx_ServerPickerDialog_otherHomeserver').type(data['homeserver_url']['local']);
            await page.locator('.mx_ServerPickerDialog_continue').click();
            // wait for the dialog to go away
            await page.locator('.mx_ServerPickerDialog').waitFor({state: 'detached'});
            await page.locator('#mx_RegistrationForm_username').waitFor({state: 'visible'});
            // Hide the server text as it contains the randomly allocated Synapse port
            await page.locator('#mx_RegistrationForm_username').type(data['username']);
            await page.locator('#mx_RegistrationForm_password').type(data['password']);
            await page.locator('#mx_RegistrationForm_passwordConfirm').type(data['password']);
            await page.locator('.mx_Login_submit').click();
            await page.locator('.mx_UseCaseSelection_skip > .mx_AccessibleButton').click();
            return 'registered';
        case 'login':
            await openApp(`#/login`);
            await page.locator('#mx_LoginForm_username').waitFor({state: 'visible'});
            await page.locator('.mx_ServerPicker_change').click();
            await page.locator('.mx_ServerPickerDialog_otherHomeserver').type(data['homeserver_url']['local']);
            await page.locator('.mx_ServerPickerDialog_continue').click();
            // wait for the dialog to go away
            //page.locator('.mx_ServerPickerDialog').should('not.exist');
            await page.locator('#mx_LoginForm_username').type(data['username']);
            await page.locator('#mx_LoginForm_password').type(data['password']);
            await page.locator('.mx_Login_submit').click();
            return 'loggedin';
        case 'start_crosssign':
            await page.locator('.mx_CompleteSecurity_actionRow > .mx_AccessibleButton').click();
            return 'started_crosssign';
        case 'accept_crosssign':
            // Can we please tag some buttons :)
            // Click 'Verify' when it comes up
            await page.locator('.mx_Toast_buttons > .mx_AccessibleButton_kind_primary').click();
            // Click to move to emoji verification
            await page.locator('.mx_VerificationPanel_QRPhase_startOption > .mx_AccessibleButton').click();
            return 'accepted_crosssign';
        case 'verify_crosssign_emoji':
            await page.locator('.mx_VerificationShowSas_buttonRow > .mx_AccessibleButton_kind_primary').click();
            await page.locator('.mx_UserInfo_container > .mx_AccessibleButton').click();
            return 'verified_crosssign';
        case 'idle':
            await new Promise(r => setTimeout(r, 5000));
            return;
        case 'create_room':
            await page.locator('.mx_RoomListHeader_plusButton').click();
            await page.locator('.mx_ContextualMenu >> text=New room').click();
            await page.locator('.mx_CreateRoomDialog_name input').type(data['name']);
            if (data['topic']) {
                await page.locator('.mx_CreateRoomDialog_topic input').type(data['topic']);
            }
            // do this to prevent https://github.com/vector-im/element-web/issues/22590, weirdly
            // page.locator('.mx_CreateRoomDialog_name input').click();
            // cy.wait(5000);

            await page.locator('.mx_Dialog_primary').click();
            //page.locator('.mx_RoomHeader_nametext').should('contain', data['name']);
            return 'room_created';
        case 'send_message':
            {
                const composer = page.locator('.mx_SendMessageComposer div[contenteditable=true]');
                await composer.type(data['message']);
                await composer.press('Enter');
                //cy.contains(data['message']).closest('mx_EventTile').should('have.class', 'mx_EventTile_receiptSent');
                return "message_sent";
            }
        case 'change_room_history_visibility':
            await page.locator('.mx_RightPanel_roomSummaryButton').click();
            await page.locator('.mx_RoomSummaryCard_icon_settings').click();
            await page.locator(`[data-testid='settings-tab-ROOM_SECURITY_TAB']`).click();
            // should be either "shared", "invited" or "joined"
            // TODO: has doesn't seem to work
            await page.locator(`label`, { has: page.locator(`#historyVis-${data['historyVisibility']}`)}).click();
            await page.locator('.mx_Dialog_cancelButton').click();
            await page.locator('[data-test-id=base-card-close-button]').click();
            return "changed";
        case 'invite_user':
            {
                await page.locator('.mx_RightPanel_roomSummaryButton').click();
                await page.locator('.mx_RoomSummaryCard_icon_people').click();
                await page.locator('.mx_MemberList_invite').click();
                const addressBar = page.locator('.mx_InviteDialog_addressBar input');
                await addressBar.type(data['user']);
                await addressBar.press('Enter');
                await page.locator('.mx_InviteDialog_goButton').click();
                return "invited";
            }
        default:
            console.log('WARNING: unknown action ', action);
            return;
    }
}
