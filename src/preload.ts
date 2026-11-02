// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from "electron";
import { AdminCodeAction, TodaysStats, EnabledActions, CurrentAttendanceEntry } from "./types";

declare global {
    interface Window {
        electron: {
            submit: (idNumber: string) => Promise<{ success: boolean, name?: string, action?: "in" | "out" }>;
            authorizeAdminCode: (pin: string) => Promise<{ success: boolean, action?: AdminCodeAction }>;
            closeAttendance: () => Promise<{ success: boolean, numClosed: number, emailed: boolean }>;
            getTodaysStats: () => Promise<TodaysStats>;
            getCurrentAttendance: () => Promise<CurrentAttendanceEntry[]>;
            getEnabledActions: () => Promise<EnabledActions>;
            getStudentIds: () => Promise<string[]>;
            exportAttendanceReport: (startDate: string, endDate: string, meetingThreshold: number, sendToSlack: boolean) => void;
            exportMeetingReport: (startDate: string, endDate: string, meetingThreshold: number, sendToSlack: boolean) => void;
            exportCheckinData: (startDate: string, endDate: string, meetingThreshold: number, sendToSlack: boolean) => void;
            importStudents: () => void;
            sendReportEmail: (reportType?: "attendance" | "meeting" | "checkin" | "all") => void;
            syncToGoogleSheet: () => void;
            onLockConsole: (callback: () => void) => void;
        }
    }
}

contextBridge.exposeInMainWorld("electron", {
    submit: (idNumber: string) => ipcRenderer.invoke("submit", idNumber),
    authorizeAdminCode: (pin: string) => ipcRenderer.invoke("authorizeAdminCode", pin),
    closeAttendance: () => ipcRenderer.invoke("closeAttendance"),
    getTodaysStats: () => ipcRenderer.invoke("getTodaysStats"),
    getCurrentAttendance: () => ipcRenderer.invoke("getCurrentAttendance"),
    getEnabledActions: () => ipcRenderer.invoke("getEnabledActions"),
    getStudentIds: () => ipcRenderer.invoke("getStudentIds"),
    exportAttendanceReport: (startDate: string, endDate: string, meetingThreshold: number, sendToSlack: boolean) =>
        ipcRenderer.send("exportAttendanceReport", startDate, endDate, meetingThreshold, sendToSlack),
    exportMeetingReport: (startDate: string, endDate: string, meetingThreshold: number, sendToSlack: boolean) =>
        ipcRenderer.send("exportMeetingReport", startDate, endDate, meetingThreshold, sendToSlack),
    exportCheckinData: (startDate: string, endDate: string, meetingThreshold: number, sendToSlack: boolean) =>
        ipcRenderer.send("exportCheckinData", startDate, endDate, meetingThreshold, sendToSlack),
    importStudents: () => ipcRenderer.send("importStudents"),
    sendReportEmail: (reportType?: "attendance" | "meeting" | "checkin" | "all") => ipcRenderer.send("sendReportEmail", reportType),
    syncToGoogleSheet: () => ipcRenderer.send("syncToGoogleSheet"),
    onLockConsole: (callback: () => void) => {
        ipcRenderer.on("lock-console", () => callback());
    },
});