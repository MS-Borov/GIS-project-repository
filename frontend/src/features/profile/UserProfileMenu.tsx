import { useEffect, useRef, useState } from "react";
import "./UserProfileMenu.css";

type UserRole = "admin" | "teacher" | "student";

type User = {
  id: number;
  email: string;
  full_name?: string | null;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

function roleLabel(role: UserRole) {
  const labels: Record<UserRole, string> = {
    admin: "Администратор",
    teacher: "Преподаватель",
    student: "Студент",
  };
  return labels[role];
}

function formatUserDate(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UserProfileMenu(props: {
  user: User;
  isLoading: boolean;
  onUpdateEmail: (email: string) => Promise<void>;
  onRefresh: () => void | Promise<void>;
  onLogout: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState(props.user.email);
  const [message, setMessage] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const displayName = props.user.full_name || props.user.email;
  const initial = displayName.slice(0, 1).toUpperCase();

  useEffect(() => {
    setEmailDraft(props.user.email);
    setMessage("");
  }, [props.user.email]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function submitEmail() {
    const email = emailDraft.trim();
    if (!email || email === props.user.email) {
      return;
    }
    setMessage("");
    try {
      await props.onUpdateEmail(email);
      setMessage("Почта обновлена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось обновить почту.");
    }
  }

  return (
    <div className="user-profile-menu" ref={rootRef}>
      <button
        className="user-profile-trigger"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((value) => !value)}
      >
        <span className="user-profile-avatar" aria-hidden="true">{initial}</span>
        <span className="user-profile-summary">
          <strong>{displayName}</strong>
          <span>{roleLabel(props.user.role)}</span>
        </span>
      </button>

      {isOpen ? (
        <div className="user-profile-popover" role="dialog" aria-label="Информация о пользователе">
          <button className="user-profile-close" type="button" onClick={() => setIsOpen(false)} aria-label="Закрыть">
            ×
          </button>
          <div className="user-profile-email">{props.user.email}</div>
          <div className="user-profile-hero">
            <span className="user-profile-avatar large" aria-hidden="true">{initial}</span>
            <strong>Здравствуйте, {props.user.full_name || props.user.email}!</strong>
            <span>{roleLabel(props.user.role)}</span>
          </div>

          <label className="user-profile-field">
            <span>Почта</span>
            <input
              type="email"
              value={emailDraft}
              onChange={(event) => setEmailDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitEmail();
                }
              }}
            />
          </label>
          <button
            className="user-profile-primary"
            type="button"
            onClick={() => void submitEmail()}
            disabled={props.isLoading || !emailDraft.trim() || emailDraft.trim() === props.user.email}
          >
            Поменять почту
          </button>
          {message ? <p className="user-profile-message">{message}</p> : null}

          <dl className="user-profile-details">
            <div>
              <dt>ID</dt>
              <dd>{props.user.id}</dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>{props.user.is_active ? "Активен" : "Отключён"}</dd>
            </div>
            <div>
              <dt>Создан</dt>
              <dd>{formatUserDate(props.user.created_at)}</dd>
            </div>
            <div>
              <dt>Обновлён</dt>
              <dd>{formatUserDate(props.user.updated_at)}</dd>
            </div>
          </dl>

          <div className="user-profile-actions">
            <button type="button" onClick={() => void props.onRefresh()} disabled={props.isLoading}>
              Проверить сессию
            </button>
            <button type="button" onClick={props.onLogout} disabled={props.isLoading}>
              Выйти
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
