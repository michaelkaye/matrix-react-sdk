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
import fetch from 'node-fetch';
import cypress from 'cypress';
import * as crypto from 'crypto';
import * as process from 'process';
function setupPromise(trafficlightUrl, uuid) {
    console.log('Registering trafficlight client');

    const data = JSON.stringify({
        type: 'element-web',
        version: 'UNKNOWN', // at some point we need to know this, but for now it's hard to determine.
    });
    const target = trafficlightUrl + '/client/' + uuid + '/register';
    const promise = fetch(target, { method: 'POST', body: data, headers: { 'Content-Type': 'application/json' } })
        .then((response) => {
            console.log(response);
            if (response.status != 200) {
                throw new Error('Unable to register client, got ' + response.status + ' from server');
            }
        });
    return promise;
}

function openPromise(trafficlightUrl, uuid) {
    return cypress
        .open({
            env: {
                'TRAFFICLIGHT_URL': trafficlightUrl,
                'TRAFFICLIGHT_UUID': uuid,
            },
            config: {
                retries: { // Override cypress.json - we want to run exactly once.
                    'openMode': 0,
                    'runMode': 0,
                },
                e2e: {
                    specPattern: './cypress/e2e/trafficlight/*.ts',
                    excludeSpecPattern: [],
                },
                videosFolder: 'cypress/videos/trafficlight/'+uuid+'/',
            },
        });
}
function runPromise(trafficlightUrl, uuid) {
    return cypress
        .run({
            spec: './cypress/e2e/trafficlight/*.ts',
            env: {
                'TRAFFICLIGHT_URL': trafficlightUrl,
                'TRAFFICLIGHT_UUID': uuid,
            },
            config: {
                retries: { // Override cypress.json - we want to run exactly once.
                    'openMode': 0,
                    'runMode': 0,
                },
                e2e: {
                    excludeSpecPattern: [],
                },
                videosFolder: 'cypress/videos/trafficlight/'+uuid+'/',
            },
            quiet: true,
        });
}

async function runOnce(trafficlightUrl) {
    const uuid = crypto.randomUUID();
    await setupPromise(trafficlightUrl, uuid);
    const cypressOpen = await openPromise(trafficlightUrl, uuid);
    console.log(cypressOpen);
}

async function runRepeatedly(trafficlightUrl) {
    while (true) {
        const uuid = crypto.randomUUID();
        // NB: we allow exceptions to propigate to top level and exit.
        await setupPromise(trafficlightUrl, uuid);
        const cypressRun = await runPromise(trafficlightUrl, uuid);
        console.log(cypressRun);
    }
}

const trafficlightUrl = 'http://localhost:5000';

const args = process.argv.slice(2);
if (args[0] == 'run') {
    runRepeatedly(trafficlightUrl).then((result) => {
        console.log('Finished looping forever(?), got ' + result);
    });
} else if (args[0] == 'open') {
    runOnce(trafficlightUrl).then((result) => {
        console.log('Finished one-shot, got ' + result);
    });
} else {
    console.error('No idea what ' + args[0] + 'means (i understand "run" to run continually, "open" to launch the UI)');
    process.exit(1);
}
