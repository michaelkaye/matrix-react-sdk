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

import puppeteer from 'puppeteer-core';
import fetch from 'node-fetch';
import * as crypto from 'crypto';
import * as process from 'process';

async function startClient() {
    const browser = await puppeteer.launch({
        executablePath: "/usr/bin/chromium-browser",
        headless: false,
        // don't exit
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto("http://localhost:8080");
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

async function startRegisterLoop(trafficlightUrl: string) {
    while (true) {
        const uuid = crypto.randomUUID();
        await registerAsClient(trafficlightUrl, uuid);
        const clientBaseUrl = `${trafficlightUrl}/client/${encodeURIComponent(uuid)}`;
        const {page, browser} = await startClient();
        await pollLoop(page, clientBaseUrl);
    }
}


const trafficlightUrl = process.env.TRAFFICLIGHT_URL || 'http://127.0.0.1:5000';

startRegisterLoop(trafficlightUrl);

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
async function pollLoop(page: puppeteer.Page, clientBaseUrl: string): Promise<void> {
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
                result = await runAction(pollData.action, pollData.data, page);
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

async function runAction(action: string, data: Record<string, any>, page: puppeteer.Page): Promise<string | undefined> {
    async function get(selector: string, root?: Promise<puppeteer.ElementHandle | null>): Promise<puppeteer.ElementHandle | null> {
        return (await getRoot(root)).waitForSelector(selector);
    }

    async function getRoot(root: Promise<puppeteer.ElementHandle | null> | undefined): Promise<puppeteer.ElementHandle | puppeteer.Page> {
        if (!root) {
            return page;
        }
        const r = await root;
        if (!r) {
            throw new Error('root evaluated to null');
        }
        return r;
    }

    async function contains(label: string, root?: Promise<puppeteer.ElementHandle | null>): Promise<puppeteer.ElementHandle | null> {
        const [element] = await (await getRoot(root)).$x(`//[contains(text(), "${label}")]`);
        return element as puppeteer.ElementHandle;
    }

    async function click(selectorPromise: Promise<puppeteer.ElementHandle | null>): Promise<void> {
        const el = await selectorPromise;
        if (el) {
            await el.click();
        }
    }

    async function type(text: string, selectorPromise: Promise<puppeteer.ElementHandle | null>, enter: boolean = false): Promise<void> {
        const el = await selectorPromise;
        if (el) {
            await el.type(text);
            if (enter) {
                await el.press('Enter');
            }
        }
    }

    async function setLocationHash(hash: string) {
        const url = new URL(await page.url());
        url.hash = hash;
        console.log("setLocationHash", url.toString());
        await page.goto(url.toString());
    }


    switch (action) {
        case 'register':
            console.log("going to", `${await page.url()}/#/register`);
            await setLocationHash(`#/register`);
            await (await get('.mx_ServerPicker_change'))!.click();
            //get('.mx_ServerPickerDialog_continue').should('be.visible');
            await type(data['homeserver_url']['local'], get('.mx_ServerPickerDialog_otherHomeserver'));
            await click(get('.mx_ServerPickerDialog_continue'));
            // wait for the dialog to go away
            //get('.mx_ServerPickerDialog').should('not.exist');
            //get('#mx_RegistrationForm_username').should('be.visible');
            // Hide the server text as it contains the randomly allocated Synapse port
            await type(data['username'], get('#mx_RegistrationForm_username'));
            await type(data['password'], get('#mx_RegistrationForm_password'));
            await type(data['password'], get('#mx_RegistrationForm_passwordConfirm'));
            await click(get('.mx_Login_submit'));
            await click(get('.mx_UseCaseSelection_skip > .mx_AccessibleButton'));
            return 'registered';
        case 'login':
            await setLocationHash(`#/login`);
            //get('#mx_LoginForm_username', { timeout: 15000 }).should('be.visible');
            await click(get('.mx_ServerPicker_change'));
            await type(data['homeserver_url']['local'], get('.mx_ServerPickerDialog_otherHomeserver'));
            await click(get('.mx_ServerPickerDialog_continue'));
            // wait for the dialog to go away
            //get('.mx_ServerPickerDialog').should('not.exist');
            await type(data['username'], get('#mx_LoginForm_username'));
            await type(data['password'], get('#mx_LoginForm_password'));
            await click(get('.mx_Login_submit'));
            return 'loggedin';
        case 'start_crosssign':
            await click(get('.mx_CompleteSecurity_actionRow > .mx_AccessibleButton'));
            return 'started_crosssign';
        case 'accept_crosssign':
            // Can we please tag some buttons :)
            // Click 'Verify' when it comes up
            await click(get('.mx_Toast_buttons > .mx_AccessibleButton_kind_primary'));
            // Click to move to emoji verification
            await click(get('.mx_VerificationPanel_QRPhase_startOption > .mx_AccessibleButton'));
            return 'accepted_crosssign';
        case 'verify_crosssign_emoji':
            await click(get('.mx_VerificationShowSas_buttonRow > .mx_AccessibleButton_kind_primary'));
            await click(get('.mx_UserInfo_container > .mx_AccessibleButton'));
            return 'verified_crosssign';
        case 'idle':
            await new Promise(r => setTimeout(r, 5000));
            return;
        case 'create_room':
            await click(get('.mx_RoomListHeader_plusButton'));
            await click(contains('New room', get('.mx_ContextualMenu')));
            await type(data['name'], get('.mx_CreateRoomDialog_name input'));
            if (data['topic']) {
                await type(data['topic'], get('.mx_CreateRoomDialog_topic input'));
            }
            // do this to prevent https://github.com/vector-im/element-web/issues/22590, weirdly
            // get('.mx_CreateRoomDialog_name input').click();
            // cy.wait(5000);

            await click(get('.mx_Dialog_primary'));
            //get('.mx_RoomHeader_nametext').should('contain', data['name']);
            return 'room_created';
        case 'send_message':
            await type(
                data['message'],
                get('.mx_SendMessageComposer div[contenteditable=true]'),
                true // type Enter too
            );
            //cy.contains(data['message']).closest('mx_EventTile').should('have.class', 'mx_EventTile_receiptSent');
            return "message_sent";
        case 'change_room_history_visibility':
            await click(get('.mx_RightPanel_roomSummaryButton'));
            await click(get('.mx_RoomSummaryCard_icon_settings'));
            await click(get(`[data-testid='settings-tab-ROOM_SECURITY_TAB']`));
            // should be either "shared", "invited" or "joined"
            await click(get(`label:has(#historyVis-${data['historyVisibility']}`));
            await click(get('.mx_Dialog_cancelButton'));
            await click(get('[data-test-id=base-card-close-button]'));
            return "changed";
        case 'invite_user':
            await click(get('.mx_RightPanel_roomSummaryButton'));
            await click(get('.mx_RoomSummaryCard_icon_people'));
            await click(get('.mx_MemberList_invite'));
            await type(data['user'], get('.mx_InviteDialog_addressBar input'), true);
            await click(get('.mx_InviteDialog_goButton'));
            return "invited";
        default:
            console.log('WARNING: unknown action ', action);
            return;
    }
}
