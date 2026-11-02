import { useState, useEffect } from "react";
import Clock from "./Clock";
import AttendanceRoster from "./AttendanceRoster";
import Form from "./Form";
import Logo from "./Logo";
import ExportModal from "./ExportModal";
import { AdminCodeAction, CurrentAttendanceEntry, EnabledActions } from "../types";

const PROMPT_SCAN = "Tap your NFC sticker on reader or enter PIN";
const PROMPT_LOCKED = "Enter attendance PIN to unlock scanning";
const PROMPT_WRONG_PIN = "Wrong PIN — try again";
const PROMPT_CLOSE_ERROR = "Could not close attendance";
const PROMPT_SUCCESS = "Check-in recorded";
const PROMPT_CLOSED = "Attendance closed";
const PROMPT_CLOSED_EMAIL = "Attendance closed and email sent";
const PROMPT_EXPORT = "Export reports";
const PROMPT_USER_NOT_FOUND = "User not Found.";
const CLOCK_PROMPT_DURATION_MS = 1200;
const USER_NOT_FOUND_PROMPT_DURATION_MS = 900;

function isClockPromptText(promptText: string) {
  return / clocked (in|out)$/i.test(promptText) || promptText === PROMPT_SUCCESS;
}

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [lastPromptTime, setLastPromptTime] = useState<Date | null>(null);
  const [promptText, setPromptText] = useState<string>(PROMPT_LOCKED);
  const [showRoster, setShowRoster] = useState<boolean>(false);
  const [attendance, setAttendance] = useState<CurrentAttendanceEntry[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);
  const [enabledActions, setEnabledActions] = useState<EnabledActions>({
    sendToSlack: false,
    sendReportEmail: false,
    sendToGoogleSheet: false,
  });

  useEffect(() => {
    window.electron.getEnabledActions().then(setEnabledActions).catch(console.error);
  }, []);

  function handleSubmit(name?: string, action: "in" | "out" = "in") {
    setPromptText(name ? `${name} clocked ${action === "out" ? "out" : "in"}` : PROMPT_SUCCESS);
    setLastPromptTime(new Date());
  }

  async function handleAdminCode(pin: string): Promise<AdminCodeAction | null> {
    const response = await window.electron.authorizeAdminCode(pin);
    if (!response.success || !response.action) {
      setPromptText(PROMPT_WRONG_PIN);
      setLastPromptTime(new Date());
      return null;
    }

    if (response.action === "export") {
      setExportModalOpen(true);
      setPromptText(PROMPT_EXPORT);
      setLastPromptTime(new Date());
      return "export";
    }

    if (response.action === "toggle-kiosk") {
      setPromptText("Kiosk mode toggled");
      setLastPromptTime(new Date());
      return "toggle-kiosk";
    }

    const nextUnlocked = !isUnlocked;
    if (!nextUnlocked) {
      const closeResponse = await window.electron.closeAttendance();
      if (!closeResponse.success) {
        setPromptText(PROMPT_CLOSE_ERROR);
        setLastPromptTime(new Date());
        return null;
      }
      setPromptText(
        closeResponse.emailed
          ? (closeResponse.numClosed > 0 ? `${PROMPT_CLOSED_EMAIL} — ${closeResponse.numClosed} checked out` : PROMPT_CLOSED_EMAIL)
          : (closeResponse.numClosed > 0 ? `${PROMPT_CLOSED} — ${closeResponse.numClosed} checked out` : PROMPT_CLOSED),
      );
    }
    setIsUnlocked(nextUnlocked);
    setShowRoster(false);
    if (nextUnlocked) {
      setPromptText(PROMPT_SCAN);
    }
    setLastPromptTime(new Date());
    return "attendance";
  }

  async function refreshAttendance() {
    try {
      const currentAttendance = await window.electron.getCurrentAttendance();
      setAttendance(currentAttendance);
    } catch (err) {
      console.log(err);
    }
  }

  useEffect(() => {
    if (window.electron.onLockConsole) {
      window.electron.onLockConsole(() => {
        setIsUnlocked(false);
        setShowRoster(false);
        setPromptText("Attendance closed via Slack");
        setLastPromptTime(new Date());
      });
    }
  }, []);

  useEffect(() => {
    if (lastPromptTime === null) {
      return;
    }
    const isClockPrompt = isClockPromptText(promptText);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (isClockPrompt) {
      timeout = setTimeout(() => setPromptText(PROMPT_SCAN), CLOCK_PROMPT_DURATION_MS);
    } else if (promptText.startsWith(PROMPT_CLOSED) || promptText === "Attendance closed via Slack") {
      timeout = setTimeout(() => setPromptText(PROMPT_LOCKED), 2000);
    } else if (promptText === PROMPT_CLOSE_ERROR) {
      timeout = setTimeout(() => setPromptText(PROMPT_LOCKED), 10000);
    } else if (promptText === PROMPT_WRONG_PIN) {
      timeout = setTimeout(() => setPromptText(PROMPT_LOCKED), 10000);
    } else if (promptText === PROMPT_USER_NOT_FOUND) {
      timeout = setTimeout(() => setPromptText(PROMPT_SCAN), USER_NOT_FOUND_PROMPT_DURATION_MS);
    }
    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [lastPromptTime, promptText]);

  useEffect(() => {
    if (!isUnlocked || !showRoster) {
      return;
    }
    refreshAttendance();
    const interval = setInterval(refreshAttendance, 10000);
    return () => clearInterval(interval);
  }, [isUnlocked, showRoster]);

  function handleCloseExportModal() {
    setExportModalOpen(false);
    setPromptText(isUnlocked ? PROMPT_SCAN : PROMPT_LOCKED);
    setLastPromptTime(new Date());
  }

  let footerClass = "footer";
  if (isClockPromptText(promptText)) {
    footerClass += " ok fullscreen-popup";
  } else if (promptText.startsWith(PROMPT_CLOSED) || promptText === "Attendance closed via Slack") {
    footerClass += " ok";
  } else if (promptText === PROMPT_WRONG_PIN || promptText === PROMPT_CLOSE_ERROR) {
    footerClass += " error";
  } else if (promptText === PROMPT_USER_NOT_FOUND) {
    footerClass += " user-not-found fullscreen-popup";
  }

  return (
    <>
      {/* HEADER SECTION */}
      <div className="header-container">
        <h1 className="title">TerrorBytes Attendance</h1>
        <p className="source-credit">Modified from 694 Attendance System</p>
      </div>

      <div className="row">
        {/* LEFT PANEL */}
        <div className="column">
          {showRoster ? <AttendanceRoster attendees={attendance} /> : <Logo />}
          <Clock />
        </div>

        {/* MIDDLE SPLITTER LINE */}
        <div className="column-divider"></div>

        {/* RIGHT PANEL */}
        <div className="column">
          {!isUnlocked ? (
            <div className="pin-panel">
              <h2>Admin PIN Required</h2>
              <Form isUnlocked={false} isActive={true} onAdminCode={handleAdminCode} onSuccess={(name, action) => { refreshAttendance(); handleSubmit(name, action); }} onUserNotFound={() => { setPromptText(PROMPT_USER_NOT_FOUND); setLastPromptTime(new Date()); }} />
            </div>
          ) : (
            <Form isUnlocked={true} isActive={true} onAdminCode={handleAdminCode} onSuccess={(name, action) => { refreshAttendance(); handleSubmit(name, action); }} onUserNotFound={() => { setPromptText(PROMPT_USER_NOT_FOUND); setLastPromptTime(new Date()); }} />
          )}
        </div>
      </div>

      {/* FOOTER STRIP */}
      <div className={footerClass}>
        <span className="prompt">{promptText}</span>
      </div>

      <ExportModal isOpen={exportModalOpen} onClose={handleCloseExportModal} enabledActions={enabledActions} />
    </>
  );
}