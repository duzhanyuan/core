/*
Copyright 2017 OpenFin Inc.

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

/*
* TODO: Remove these after Dependency Injection refactor:
* const manifestProxySettings
* const startManifest
* function getManifestProxySettings
* function getStartManifest
* function setManifestProxySettings
* function setStartManifest
* */

import * as minimist from 'minimist';
import { app } from 'electron';
import { ExternalApplication } from './api/external_application';
import { PortInfo } from './port_discovery';
import * as Shapes from '../shapes';
import * as log from './log';

export interface StartManifest {
    data: Shapes.Manifest;
    url: string;
}

interface ProxySettingsArgs {
    proxyAddress?: string;
    proxyPort?: number;
    type?: string;
}

interface ApplicationMeta {
    isRunning: boolean;
    parentUuid: string;
    uuid: string;
}

interface WindowMeta {
    childWindows: Shapes.BrowserWindow[];
    mainWindow: Shapes.BrowserWindow;
    uuid: string;
}

export const args = app.getCommandLineArguments(); // arguments as a string
export const argv = app.getCommandLineArgv(); // arguments as an array
export const argo = minimist(argv); // arguments as an object

export const apps: Shapes.App[] = [];

let startManifest = {};

// TODO: This needs to go go away, pending socket server refactor.
let socketServerState = {};

const manifestProxySettings: Shapes.ProxySettings = {
    proxyAddress: '',
    proxyPort: 0,
    type: 'system'
};

export function setStartManifest(url: string, data: Shapes.Manifest): void {
    startManifest = { url, data };
    setManifestProxySettings((data && data.proxy) || undefined);
}

export function getStartManifest(): StartManifest|{} {
    return startManifest;
}

// Returns string on error
export function setManifestProxySettings(proxySettings: ProxySettingsArgs): void|string {

    // Proxy settings from a config serve no behavioral purpose in 5.0
    // They are merely a read/write data-store.
    if (typeof proxySettings === 'object') {
        const type = proxySettings.type;

        if (!type.includes('system') && !type.includes('named')) {
            return 'Invalid proxy type. Should be "system" or "named"';
        }

        manifestProxySettings.proxyAddress = proxySettings.proxyAddress || '';
        manifestProxySettings.proxyPort = proxySettings.proxyPort || 0;
        manifestProxySettings.type = type;
    }
}

export function getManifestProxySettings(): Shapes.ProxySettings {
    return manifestProxySettings;
}

export function windowExists(uuid: string, name: string): boolean {
    return !!getOfWindowByUuidName(uuid, name);
}

export function removeChildById(id: number): void {
    const app = getAppByWin(id);

    if (app) {

        // if this was a child window make sure we clean up as well.
        app.children.forEach(win => {
            win.children = win.children.filter(wChildId => {
                return wChildId !== id;
            });
        });

        if (app && app.children) {
            app.children = app.children.filter(child => {
                return child.id !== id;
            });
        }
    }
}

export function getChildrenByWinId(id: number): boolean|Array<number|string> {
    const win = getWinById(id);
    return win && win.children;
}

export function getAppByWin(id: number): Shapes.App|undefined {
    return apps.find(app => {
        return !!app.children.find(win => {
            return win.id === id;
        });
    });
}

function getAppById(id: number): Shapes.App {
    return apps.find(app => app.id === id); // This will hide a leak
}

export function appByUuid(uuid: string): Shapes.App {
    return apps.find(app => uuid === app.uuid);
}

export const getAppByUuid = appByUuid;

export function setAppRunningState(uuid: string, isRunning: boolean): void {
    const app = appByUuid(uuid);

    if (app) {
        app.isRunning = isRunning;
    }
}

export function getAppRunningState(uuid: string): boolean {
    const app = appByUuid(uuid);
    return app && app.isRunning;
}

export function getAppRestartingState(uuid: string): boolean {
    const app = appByUuid(uuid);
    return app && app.isRestarting;
}

export function setAppRestartingState(uuid: string, isRestarting: boolean): void {
    const app = appByUuid(uuid);

    if (app) {
        app.isRestarting = isRestarting;
    }
}

export function setAppId(uuid: string, id: number): void {
    const app = appByUuid(uuid);

    if (!app) {
        console.warn('setAppId - app not found', arguments);
        return;
    }

    app.id = id;
    app.children = [{
        children: [],
        id: id,
        openfinWindow: null
    }];
}

export function getAppObjByUuid(uuid: string): Shapes.AppObj|boolean {
    const app = appByUuid(uuid);
    return app && app.appObj;
}

export function getExternalAppObjByUuid(uuid: string): Shapes.Identity|undefined {
    const allExternalConnections = ExternalApplication.getAllExternalConnctions();
    return allExternalConnections.find(ea => ea.uuid === uuid);
}

export function getUuidBySourceUrl(sourceUrl: string): string|boolean {
    const app = apps.find(app => {
        const configUrl = app.appObj && app.appObj._configUrl;
        return configUrl && configUrl === sourceUrl;
    });

    return app && app.appObj && app.appObj.uuid;
}

export function getConfigUrlByUuid(uuid: string): string|boolean {
    const app = getAppAncestor(uuid);
    if  (app && app._configUrl) {
        return app._configUrl;
    } else {
        const externalApp = getExternalAncestor(uuid);
        return externalApp && externalApp.configUrl;
    }
}

export function setAppObj(id: number, appObj: Shapes.AppObj): Shapes.App|void {
    const app = getAppById(id);

    if (!app) {
        console.warn('setAppObj - app not found', arguments);
        return; //throw new Error('setAppObj - app not found');
    }

    if (!appObj) {
        console.warn('setAppObj - no app object provided', arguments);
        return; //throw new Error('setAppObj - no app object provided');
    }

    app.appObj = appObj;

    return app;
}

export function getAppObj(id: number): Shapes.AppObj|void {
    const app = getAppById(id);

    if (!app) {
        console.warn('getAppObj - app not found', arguments);
        return; //throw new Error('getAppObj - app not found');
    }

    return app.appObj;
}

export function setAppOptions(opts: Shapes.WindowOptions, configUrl: string = ''): Shapes.App|void {
    const app = appByUuid(opts.uuid);

    if (!app) {
        console.warn('setAppOptions - app not found', arguments);
        return; //throw new Error('setAppObj - app not found');
    }

    app._configUrl = configUrl;
    app._options = opts; // need to save options so app can re-run

    return app;
}

export function getWinById(id: number| string): Shapes.Window|undefined {
    return getWinList().find(win => win.id === id);
}

export function getChildrenByApp(id: number): Shapes.OpenFinWindow[]|void {
    const app = getAppById(id);

    if (!app) {
        console.warn('getChildrenByApp - app not found', arguments);
        return; //throw new Error('getAppObj - app not found');
    }

    // Only return children who have an openfin window object and are not the app's main window (5.0 behavior)
    return app.children
        .filter(child => child.openfinWindow && child.openfinWindow.name !== child.openfinWindow.uuid)
        .map(child => child.openfinWindow);
}

// perhaps just check parentId === child for iframe check?
export function addChildToWin(parentId: number, childId: number): number|void {
    const app = getAppByWin(parentId);

    if (!app) {
        console.warn('addChildToWin - parent app not found', arguments);
        return; //throw new Error('addChildToWin - parent app not found');
    }

    // reenable?
    //	if (parentId !== childId) {
    const parent = getWinById(parentId);

    if (!parent) {
        console.warn('addChildToWin - parent window not found', arguments);
        return; //throw new Error('addChildToWin - parent window not found');
    }

    parent.children.push(childId);

    return app.children.push({
        children: [],
        id: childId, //should the be null if isIframe???
        openfinWindow: null,
        parentId: parentId
        //isIframe
    });
}

export function updateWinName(uuid: string, name: string,  newId: number | string): boolean {
    const winToUpdate = getOfWindowByUuidName(uuid, name);
    const {parentId} = winToUpdate;
    const parent = getWinById(parentId);

    parent.children = parent.children.filter(id => id !== name);
    parent.children.push(newId);
    winToUpdate.id = newId;

    return false;
}

export function getWinObjById(id: number): Shapes.OpenFinWindow|void {
    const win = getWinById(id);

    if (!win) {
        console.warn('getWinObjById - window not found', arguments);
        return; //throw new Error('getWinObjById - window not found');

    }

    //console.log('\n\ngetWinObjById DONE', arguments);
    return win.openfinWindow;
}

export function addApp(id: number, uuid: string): Shapes.App[] {
    // id is optional

    apps.push({
        appObj: null,
        children: [{
            id: id,
            openfinWindow: null,
            children: []
        }],
        id: id,
        isRunning: false,
        uuid,

        // hide-splashscreen is sent to RVM on 1st window show &
        // immediately on subsequent app launches if already sent once
        sentHideSplashScreen: false
    });

    return apps;
}

export function sentFirstHideSplashScreen(uuid: string): boolean {
    const app = appByUuid(uuid);
    return app && app.sentHideSplashScreen;
}

export function setSentFirstHideSplashScreen(uuid: string, sent: boolean): void {
    const app = appByUuid(uuid);
    if (app) {
        app.sentHideSplashScreen = sent;
    }
}

// what should the name be?
export function setWindowObj(id: number, openfinWindow: Shapes.OpenFinWindow): Shapes.Window|void {
    const win = getWinById(id);

    if (!win) {
        console.warn('setWindow - window not found', arguments);
        return; //throw new Error('setWindow - window not found');
    }

    if (!openfinWindow) {
        console.warn('setWindow - no window object provided', arguments);
        return; //throw new Error('setWindow - no window object provided');
    }

    win.openfinWindow = openfinWindow;

    return win;
}

export function removeApp(id: number): void {
    const app = getAppById(id);

    if (!app) {
        console.warn('removeApp - app not found', arguments);
        return; //throw new Error('removeApp - app not found');
    }

    delete app.appObj;

    app.isRunning = false;

    // apps = apps.filter(app => app.id !== id);

    // return apps;
}

export function getWindowOptionsById(id: number): Shapes.WindowOptions|boolean {
    const win = getWinById(id);
    return win.openfinWindow && win.openfinWindow._options;
}

export function getMainWindowOptions(id: number): Shapes.WindowOptions|void {
    const app = getAppByWin(id);

    if (!app) {
        console.warn('getMainWindowOptions - app not found', arguments);
        return; //throw new Error('getMainWindowOptions - app not found');
    }

    if (!app.appObj) {
        console.warn('getMainWindowOptions - app opts not found', arguments);
        return; //throw new Error('getMainWindowOptions - app opts not found');
    }

    // console.log('getMainWindowOptions', app.appObj._options);
    return app.appObj._options;
}

export function getWindowByUuidName(uuid: string, name: string): Shapes.OpenFinWindow|boolean {
    const win = getOfWindowByUuidName(uuid, name);
    return win && win.openfinWindow;
}

function getOfWindowByUuidName(uuid: string, name: string): Shapes.Window|undefined {
    return getWinList().find(win => win.openfinWindow &&
        win.openfinWindow.uuid === uuid &&
        win.openfinWindow.name === name
    );
}

/**
 * returns a list of wrapped window objects
 * TODO flatten this one level
 */
function getWinList(): Shapes.Window[] {
    return apps
        .map(app => app.children) //with children
        .reduce((wins, myWins) => wins.concat(myWins), []); //flatten
}

export function getAllApplications(): ApplicationMeta[] {
    return apps.map(app => {
        return {
            isRunning: app.isRunning,
            parentUuid: app.parentUuid,
            uuid: app.uuid
        };
    });
}

//TODO: should this function replace getAllApplications ?
export function getAllAppObjects(): Shapes.AppObj[] {
    return apps
        .filter(app => app.appObj) //with openfin app object
        .map(app => app.appObj); //and return same
}

export function getAllWindows(): WindowMeta[] {
    const getBounds = require('./api/window.js').Window.getBounds; // do not move this line!
    return apps.map(app => {
        const windowBounds = app.children
            .filter(win => win.openfinWindow && win.id !== app.id)
            .map(win => {
                const bounds = getBounds({
                    name: win.openfinWindow.name,
                    uuid: win.openfinWindow.uuid
                });
                bounds.name = win.openfinWindow.name;
                return bounds;
            });

        return {
            childWindows: windowBounds,
            mainWindow: windowBounds[0] || {},
            uuid: app.uuid
        };
    });
}

function anyAppRestarting(): boolean {
    return !!apps.find(app => app.isRestarting);
}

export function shouldCloseRuntime(ignoreArray: string[]|undefined): boolean {
    const ignoredApps = ignoreArray || [];

    if (anyAppRestarting()) {
        console.warn('not close Runtime during app restart');
        return false;
    } else {
        const extConnections = ExternalApplication.getAllExternalConnctions();
        const hasPersistentConnections = extConnections.find(
            conn => conn.nonPersistent === undefined || !conn.nonPersistent
        );

        return !hasPersistentConnections && !getAllAppObjects().find(app => {
            const nonPersistent = app._options.nonPersistent !== undefined ? app._options.nonPersistent : app._options.nonPersistant;
            return getAppRunningState(app.uuid) && // app is running
                ignoredApps.indexOf(app.uuid) < 0 && // app is not being ignored
                !nonPersistent; // app is persistent
            }
        );
    }
}

//TODO: This needs to go go away, pending socket server refactor.
export function setSocketServerState(state: PortInfo) {
    socketServerState = state;
}

//TODO: This needs to go go away, pending socket server refactor.
export function getSocketServerState() {
    return socketServerState;
}

/**
 * Get app's very first ancestor
 */
export function getAppAncestor(descendantAppUuid: string): Shapes.App {
    const app = appByUuid(descendantAppUuid);

    if (app && app.parentUuid) {
        return getAppAncestor(app.parentUuid);
    } else {
        return app;
    }
}

function getExternalAncestor(descendantAppUuid: string): any {
    const app = appByUuid(descendantAppUuid);
    if (app && app.parentUuid) {
        return getExternalAncestor(app.parentUuid);
    } else {
        return ExternalApplication.getExternalConnectionByUuid(descendantAppUuid);
    }
}

export function setLicenseKey(identity: Shapes.Identity, licenseKey: string): string|null {
    const { uuid } = identity;
    const app = getAppByUuid(uuid);
    const externalConnection = ExternalApplication.getExternalConnectionByUuid(uuid);

    if (app) {
        app.licenseKey = licenseKey;

        return licenseKey;
    } else if (externalConnection) {
        externalConnection.licenseKey = licenseKey;

        return licenseKey;
    } else {
        return null;
    }
}

export function getLicenseKey(identity: Shapes.Identity): string|null {
    const { uuid } = identity;
    const app = getAppByUuid(uuid);
    const externalConnection = ExternalApplication.getExternalConnectionByUuid(uuid);

    if (app) {
        return app.licenseKey;
    } else if (externalConnection) {
        return externalConnection.licenseKey;
    } else {
        return null;
    }
}

export function getRoutingInfoByUuidFrame(uuid: string, frame: string) {
    log.writeToLog(1, `really??? ${uuid}, ${frame}` , true);
    const app = appByUuid(uuid);

    if (!app) {
        return;
    }

    for (const { openfinWindow } of app.children) {
        const { name, isIframe, parentFrameId } = openfinWindow;
        let browserWindow: Shapes.BrowserWindow;
        browserWindow = openfinWindow.browserWindow;

        if (name === frame) {
            return {
                name,
                browserWindow,
                frameRoutingId: 1,
                frameName: name
            };
        } else if (openfinWindow.frames[frame]) {
            const {name, frameRoutingId} = openfinWindow.frames[frame];
            log.writeToLog(1, 'we made it!' , true);
            log.writeToLog(1, `${JSON.stringify(openfinWindow.frames[frame])}` , true);
            return {
                name,
                browserWindow,
                frameRoutingId,
                frameName: name
            };
        } else {
            throw new Error(`${uuid} / ${name} not found!!`);
        }

        // if (name !== frame) {
        //     continue;
        // }

        // const isMainRenderFrame = !isIframe; //name === frame;

        // log.writeToLog(1, `aaaand ${name}, ${isIframe}, ${parentFrameId} ` , true);

        // if (isMainRenderFrame) {
        //     // log.writeToLog(1, 'really???' , true);
        //     browserWindow = openfinWindow.browserWindow;
        // }  else if (isIframe && parentFrameId !== undefined) {
        //     const parentWin = getWinById(parentFrameId);
        //     browserWindow = parentWin.openfinWindow.browserWindow;
        // }

        // log.writeToLog(1, `${Object.keys(openfinWindow)}` , true);
        // log.writeToLog(1, `${name} -- ${frame} --> ${isMainRenderFrame}` , true);
        // if (isMainRenderFrame) {
        //     log.writeToLog(1, `sent to main render frame ${{
        //         name,
        //         browserWindow,
        //         frameRoutingId: 1,
        //         frameName: name
        //     }}` , true);
        //     // todo ensure that this is still correct with the different frameConnect opts
        //     return {
        //         name,
        //         browserWindow,
        //         frameRoutingId: 1,
        //         frameName: name
        //     };
        // } else {
        //     const frameInfo = browserWindow.webContents.hasFrame(frame);
        //     log.writeToLog(1, 'has frame info? ' + frameInfo, true);

        //     if (frameInfo) {

        //         return Object.assign({
        //             name,
        //             browserWindow
        //         }, frameInfo);
        //     }
        // }
    } // end for ofwin of app.children
}
