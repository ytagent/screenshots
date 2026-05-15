import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('scrollshotController', {
  finish: () => {
    ipcRenderer.send('SCREENSHOTS:longScreenshot-controller-finish');
  },
  cancel: () => {
    ipcRenderer.send('SCREENSHOTS:longScreenshot-controller-cancel');
  },
});
