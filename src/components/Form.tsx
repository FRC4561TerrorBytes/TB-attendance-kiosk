import React, { useEffect, useState } from "react"; 
import { AdminCodeAction } from "../types"; 

interface FormProps { 
  isUnlocked: boolean; 
  isActive: boolean; 
  onAdminCode: (pin: string) => Promise<AdminCodeAction | null>; 
  onSuccess: (name: string, action: "in" | "out") => void; 
  onUserNotFound?: () => void; 
} 

function isDigit(c: string) { 
  return c >= "0" && c <= "9"; 
} 

export default function Form({ isUnlocked, isActive, onAdminCode, onSuccess, onUserNotFound }: FormProps) { 
  const [value, setValue] = useState(""); 
  const [isLastInputFromNumpad, setIsLastInputFromNumpad] = useState(false); 
  const [lastShakeTime, setLastShakeTime] = useState<Date | null>(null); 
  const [isShaking, setIsShaking] = useState(false); 
  const [backspaceDownTime, setBackspaceDownTime] = useState<Date | null>(null); 
  const [activeButton, setActiveButton] = useState<string | null>(null); 
  const [validStudentIds, setValidStudentIds] = useState<string[]>([]);
  
  function handleNumpadButtonClick(e: React.MouseEvent<HTMLButtonElement>) { 
    const digit = e.currentTarget.value; 
    const nextValue = value + digit;
    setValue(nextValue);
    setIsLastInputFromNumpad(true);
  } 

  function isKnownStudentTag(candidate: string) {
    return validStudentIds.includes(candidate);
  }

  function handleBackspaceDown(e: React.PointerEvent<HTMLButtonElement>) { 
    handleButtonActive(e); 
    setBackspaceDownTime(new Date()); 
  } 

  function handleBackspaceUp() { 
    handleButtonInactive(); 
    if (backspaceDownTime === null) { 
      return; 
    } 
    setValue(current => current.slice(0, -1)); 
    setBackspaceDownTime(null); 
  } 

  function handleBackspaceLeave() { 
    handleButtonInactive(); 
    setBackspaceDownTime(null); 
  } 

  function handleChangeFromKeyboardInput(e: React.ChangeEvent<HTMLInputElement>) { 
    const nextValue = e.target.value;
    if (isLastInputFromNumpad && (e.nativeEvent as InputEvent).inputType === "deleteContentBackward") {
      setValue("");
      return;
    }

    if (nextValue.length === 0) {
      setValue("");
      return;
    }

    if (!isDigit(nextValue[nextValue.length - 1])) {
      return;
    }

    if (isLastInputFromNumpad) {
      setValue(nextValue[nextValue.length - 1]);
    } else {
      setValue(nextValue);
    }
    setIsLastInputFromNumpad(false);
  } 

  async function handleSubmit(event: React.FormEvent) { 
    event.preventDefault(); 

    // 1. Check if the entered code is an admin or export PIN via IPC
    const adminAction = await onAdminCode(value);
    if (adminAction !== null) {
      setValue("");
      return;
    }

    // 2. If screen is locked and code was not a valid PIN, shake input and reset
    if (!isUnlocked) {
      setValue("");
      setLastShakeTime(new Date());
      return;
    }

    // 3. Screen is unlocked: proceed with standard student ID validation
    if (validStudentIds.length > 0 && !isKnownStudentTag(value)) {
      if (typeof onUserNotFound === "function") {
        onUserNotFound();
      }
      setValue("");
      return;
    }

    const response = await window.electron.submit(value);
    if (!response.success) {
      if (typeof onUserNotFound === "function") {
        onUserNotFound();
      }
      setValue("");
      return;
    }
    
    setValue("");
    
    const clientName = response.name || `ID #${value}`;
    onSuccess(clientName, response.action || "in"); 
  } 
  function handleBlur(e: React.FocusEvent) { 
  // Typecast the generic target as an HTMLInputElement
  const target = e.target as HTMLInputElement;

  if (isActive && document.activeElement !== target) { 
    target.focus(); 
  } 
}

  function handleButtonActive(e: React.PointerEvent<HTMLButtonElement>) { 
    setActiveButton(e.currentTarget.value); 
  } 

  function handleButtonInactive() { 
    if (activeButton === null) { 
      return; 
    } 
    setActiveButton(null); 
  } 

  useEffect(() => { 
    if (lastShakeTime === null) { 
      return; 
    } 
    setIsShaking(true); 
    const timeout = setTimeout(() => setIsShaking(false), 400); 
    return () => clearTimeout(timeout); 
  }, [lastShakeTime]); 

  useEffect(() => {
    if (backspaceDownTime === null) {
      return;
    }
    const timeout = setTimeout(() => setValue(""), 500);
    return () => clearTimeout(timeout);
  }, [backspaceDownTime]);

  useEffect(() => {
    window.electron.getStudentIds().then(setValidStudentIds);
  }, []);

  return (
    <div> 
      <form onSubmit={handleSubmit}> 
        <input 
          type={isUnlocked ? "text" : "password"} 
          name="id-number" 
          className={"id-number-input" + (isShaking ? " shake" : "")} 
          value={value} 
          onChange={handleChangeFromKeyboardInput} 
          onBlur={handleBlur} 
          autoFocus 
          disabled={!isActive} 
        /> 
      </form> 

      <div className="numpad"> 
        {Array.from({length: 9}, (_, i) => ( 
          <button 
            key={i + 1} 
            value={i + 1} 
            className={activeButton === (i + 1).toString() ? "active" : ""} 
            onClick={handleNumpadButtonClick} 
            onPointerDown={handleButtonActive} 
            onPointerUp={handleButtonInactive} 
            onPointerLeave={handleButtonInactive} 
          > 
            {i + 1} 
          </button> 
        ))} 
        <button 
          value="backspace" 
          className={activeButton === "backspace" ? "active" : ""} 
          onPointerDown={handleBackspaceDown} 
          onPointerUp={handleBackspaceUp} 
          onPointerLeave={handleBackspaceLeave} 
        > 
          ⌫ 
        </button> 
        <button 
          value="0" 
          className={activeButton === "0" ? "active" : ""} 
          onClick={handleNumpadButtonClick} 
          onPointerDown={handleButtonActive} 
          onPointerUp={handleButtonInactive} 
          onPointerLeave={handleButtonInactive} 
        > 
          0 
        </button> 
        <button 
          value="submit" 
          className={activeButton === "submit" ? "active" : ""} 
          onClick={(e) => handleSubmit(e)} 
          onPointerDown={handleButtonActive} 
          onPointerUp={handleButtonInactive} 
          onPointerLeave={handleButtonInactive} 
        > 
          ⏎ 
        </button> 
      </div>
    </div> 
  ); 
}