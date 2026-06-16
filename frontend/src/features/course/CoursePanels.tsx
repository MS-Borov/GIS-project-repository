import { useState } from "react";
import { CheckIcon, CloseIcon, RestoreIcon, TrashIcon } from "../../shared/ui/ToolbarIcons";

type CourseTab = "stream" | "assignments" | "submissions" | "layers" | "requirements" | "people" | "trash";

type Course = {
  id: number;
  title: string;
  description?: string | null;
};

type Assignment = {
  id: number;
  title: string;
  description?: string | null;
  deleted_at?: string | null;
  my_submission_status?: string | null;
};

const TRASH_RETENTION_DAYS = 7;

function trashCountdownLabel(deletedAt?: string | null) {
  if (!deletedAt) {
    return "В корзине";
  }
  const deleted = new Date(deletedAt).getTime();
  if (Number.isNaN(deleted)) {
    return "В корзине";
  }
  const msLeft = deleted + TRASH_RETENTION_DAYS * 86_400_000 - Date.now();
  if (msLeft <= 0) {
    return "Будет удалено при ближайшей очистке";
  }
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  return `Удалится через ${daysLeft} дн.`;
}

function submissionStatusBadge(status?: string | null) {
  const value = (status ?? "").toLowerCase();
  if (value === "pending") return "На проверке";
  if (value === "accepted") return "Принято";
  if (value === "returned") return "Вернули на доработку";
  return null;
}

function isAssignmentDone(status?: string | null) {
  const value = (status ?? "").toLowerCase();
  return value === "pending" || value === "accepted";
}

type User = {
  email: string;
  full_name?: string | null;
};

type CourseMember = {
  id: number;
  role: "teacher" | "student";
  user: User;
};
export function CourseHeader(props: {
  course: Course;
  role: "teacher" | "student";
  selectedAssignment: Assignment | null;
  assignmentsCount: number;
  submissionsCount: number;
  trashedCount?: number;
  activeTab: CourseTab;
  onTabChange: (tab: CourseTab) => void;
}) {
  const tabs: { id: CourseTab; label: string }[] = [
    { id: "stream", label: "Лента" },
    { id: "assignments", label: "Задания" },
    { id: "submissions", label: props.role === "teacher" ? "Сдачи" : "Мои работы" },
    { id: "layers", label: "Слои" },
    { id: "people", label: "Участники" },
  ];

  if (props.role === "teacher") {
    tabs.push({ id: "requirements", label: "Требования" });
    tabs.push({
      id: "trash",
      label: props.trashedCount ? `Корзина (${props.trashedCount})` : "Корзина",
    });
  }

  return (
    <section className="course-shell">
      <div className="course-banner">
        <div>
          <p className="eyebrow">{props.role === "teacher" ? "Класс преподавателя" : "Класс студента"}</p>
          <h2>{props.course.title}</h2>
          <p>
            {props.course.description ||
              "Учебное пространство для выдачи ГИС-заданий, сдачи архивов и автоматической проверки отчётов и слоёв."}
          </p>
          {props.selectedAssignment ? <small>Текущее задание: {props.selectedAssignment.title}</small> : null}
        </div>
        <div className="course-stats">
          <span>{props.assignmentsCount} заданий</span>
          <span>{props.submissionsCount} сдач</span>
          <span>{props.role === "teacher" ? "Преподаватель" : "Студент"}</span>
        </div>
      </div>

      <nav className="course-tabs" aria-label="Разделы курса">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={props.activeTab === tab.id ? "active" : ""}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </section>
  );
}

export function ClassStream(props: {
  role: "teacher" | "student";
  selectedAssignment: Assignment | null;
  submissionsCount: number;
  hasExpectedOutputs: boolean;
}) {
  return (
    <section className="stream-grid">
      <aside className="upcoming-panel">
        <h3>Ближайшее</h3>
        <p>{props.selectedAssignment ? "Выбрано текущее задание курса." : "Выберите задание слева."}</p>
        <strong>{props.selectedAssignment?.title ?? "Нет выбранного задания"}</strong>
      </aside>

      <div className="stream-list">
        <article className="stream-card">
          <div className="stream-icon">GIS</div>
          <div>
            <h3>{props.selectedAssignment?.title ?? "Задание курса"}</h3>
            <p>
              {props.role === "teacher"
                ? "Загрузите файл задания, проверьте извлечённые требования и откройте сдачи студентов."
                : "Откройте задание, прикрепите архив с отчётом и ГИС-файлами, затем посмотрите автоматическую обратную связь."}
            </p>
          </div>
        </article>

        <article className="stream-card">
          <div className="stream-icon">AI</div>
          <div>
            <h3>Автоматическая проверка</h3>
            <p>
              {props.hasExpectedOutputs
                ? "Для задания есть формальные ГИС-результаты: система сверяет слои, форматы, геометрию, систему координат и атрибуты."
                : "Если явных ГИС-результатов нет, система анализирует отчёт, вложенные файлы и ограничения проверки."}
            </p>
          </div>
        </article>

        <article className="stream-card">
          <div className="stream-icon">{props.submissionsCount}</div>
          <div>
            <h3>{props.role === "teacher" ? "Сданные работы" : "Мои отправки"}</h3>
            <p>Сейчас в выбранном контексте отображается {props.submissionsCount} submission.</p>
          </div>
        </article>
      </div>
    </section>
  );
}

export function AssignmentOverview(props: {
  mode: "teacher" | "student";
  assignments: Assignment[];
  selectedAssignmentId: number | null;
  isLoading: boolean;
  onAssignmentSelect: (id: number) => void;
  onOpenWorkspace?: (id: number) => void;
  onContinueDraft?: (id: number) => void;
  onDeleteAssignment?: (id: number) => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [studentTab, setStudentTab] = useState<"assigned" | "done">("assigned");
  const canDelete = props.mode === "teacher" && Boolean(props.onDeleteAssignment);

  function renderAssignment(assignment: Assignment) {
    const badge = props.mode === "student" ? submissionStatusBadge(assignment.my_submission_status) : null;
    const badgeClass = `assignment-badge badge-${(assignment.my_submission_status ?? "").toLowerCase() || "none"}`;
    return (
      <article
        key={assignment.id}
        className={[
          "classwork-item",
          assignment.id === props.selectedAssignmentId ? "active" : "",
          canDelete ? "has-corner-actions" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          className="classwork-main"
          onClick={() => props.onAssignmentSelect(assignment.id)}
          disabled={props.isLoading}
        >
          <span className="classwork-dot">#</span>
          <span>
            <strong>{assignment.title}</strong>
            <small>{assignment.description || `Задание #${assignment.id}`}</small>
            {badge ? <span className={badgeClass}>{badge}</span> : null}
          </span>
        </button>

        {canDelete ? (
          <div className="classwork-corner-actions">
            {confirmDeleteId === assignment.id ? (
              <>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={() => {
                    props.onDeleteAssignment?.(assignment.id);
                    setConfirmDeleteId(null);
                  }}
                  disabled={props.isLoading}
                  title="Подтвердить — переместить в корзину"
                  aria-label="Подтвердить удаление"
                >
                  <CheckIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setConfirmDeleteId(null)}
                  disabled={props.isLoading}
                  title="Отмена"
                  aria-label="Отмена"
                >
                  <CloseIcon />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="icon-button danger"
                onClick={() => setConfirmDeleteId(assignment.id)}
                disabled={props.isLoading}
                title="Переместить задание в корзину"
                aria-label="Удалить задание"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        ) : null}

        {props.mode === "student" ? (
          <div className="classwork-actions">
            <button onClick={() => props.onOpenWorkspace?.(assignment.id)} disabled={props.isLoading}>
              Открыть карту
            </button>
            <button onClick={() => props.onContinueDraft?.(assignment.id)} disabled={props.isLoading}>
              Продолжить черновик
            </button>
            <button onClick={() => props.onAssignmentSelect(assignment.id)} disabled={props.isLoading}>
              Сдать архив
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  if (props.mode === "student") {
    const active = props.assignments.filter((a) => !isAssignmentDone(a.my_submission_status));
    const done = props.assignments.filter((a) => isAssignmentDone(a.my_submission_status));
    const shown = studentTab === "done" ? done : active;
    return (
      <section className="section-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Задания</p>
            <h2>Задания курса</h2>
          </div>
        </div>

        <nav className="assignment-subtabs" aria-label="Фильтр заданий">
          <button
            type="button"
            className={studentTab === "assigned" ? "active" : ""}
            onClick={() => setStudentTab("assigned")}
          >
            Назначенные <span className="subtab-count">{active.length}</span>
          </button>
          <button
            type="button"
            className={studentTab === "done" ? "active" : ""}
            onClick={() => setStudentTab("done")}
          >
            Выполненные <span className="subtab-count">{done.length}</span>
          </button>
        </nav>

        <div className="classwork-list">
          {shown.length === 0 ? (
            <p className="muted">
              {studentTab === "done" ? "Пока нет сданных работ." : "Нет назначенных заданий."}
            </p>
          ) : null}
          {shown.map(renderAssignment)}
        </div>
      </section>
    );
  }

  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Задания</p>
          <h2>Задания курса</h2>
        </div>
      </div>
      <div className="classwork-list">
        {props.assignments.length === 0 ? <p className="muted">Пока нет созданных заданий.</p> : null}
        {props.assignments.map(renderAssignment)}
      </div>
    </section>
  );
}

export function TrashPanel(props: {
  trashedAssignments: Assignment[];
  isLoading: boolean;
  onRestoreAssignment: (id: number) => void;
  onRefresh?: () => void;
}) {
  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Корзина</p>
          <h2>Удалённые задания</h2>
        </div>
        {props.onRefresh ? (
          <button onClick={props.onRefresh} disabled={props.isLoading}>
            Обновить
          </button>
        ) : null}
      </div>
      <p className="muted">
        Удалённые задания хранятся {TRASH_RETENTION_DAYS} дней, затем удаляются окончательно вместе со сдачами.
      </p>
      <div className="trash-list">
        {props.trashedAssignments.length === 0 ? <p className="muted">Корзина пуста.</p> : null}
        {props.trashedAssignments.map((assignment) => (
          <div key={assignment.id} className="trash-row">
            <div className="trash-row-main">
              <strong>{assignment.title}</strong>
              <span>{trashCountdownLabel(assignment.deleted_at)}</span>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => props.onRestoreAssignment(assignment.id)}
              disabled={props.isLoading}
              title="Восстановить задание"
              aria-label="Восстановить задание"
            >
              <RestoreIcon />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PeoplePanel(props: {
  mode: "teacher" | "student";
  courseMembers: CourseMember[];
  memberEmail?: string;
  memberRole?: "student" | "teacher";
  isLoading: boolean;
  onLoadCourseMembers: () => void;
  onAddCourseMember?: () => void;
  onRemoveCourseMember?: (memberId: number) => void;
  onMemberEmailChange?: (value: string) => void;
  onMemberRoleChange?: (value: "student" | "teacher") => void;
}) {
  const teachers = props.courseMembers.filter((member) => member.role === "teacher");
  const students = props.courseMembers.filter((member) => member.role === "student");

  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">People</p>
          <h2>Участники курса</h2>
        </div>
        <button onClick={props.onLoadCourseMembers} disabled={props.isLoading}>
          Обновить
        </button>
      </div>

      {props.mode === "teacher" ? (
        <div className="people-add-panel">
          <label>
            Email участника
            <input
              type="email"
              value={props.memberEmail ?? ""}
              onChange={(event) => props.onMemberEmailChange?.(event.target.value)}
              placeholder="student@example.com"
            />
          </label>
          <label>
            Роль
            <select
              value={props.memberRole ?? "student"}
              onChange={(event) => props.onMemberRoleChange?.(event.target.value as "student" | "teacher")}
            >
              <option value="student">Студент</option>
              <option value="teacher">Преподаватель</option>
            </select>
          </label>
          <button className="primary" onClick={props.onAddCourseMember} disabled={props.isLoading}>
            Добавить
          </button>
        </div>
      ) : null}

      <div className="people-groups">
        <PeopleGroup
          title="Преподаватели"
          members={teachers}
          mode={props.mode}
          isLoading={props.isLoading}
          onRemoveCourseMember={props.onRemoveCourseMember}
        />
        <PeopleGroup
          title="Студенты"
          members={students}
          mode={props.mode}
          isLoading={props.isLoading}
          onRemoveCourseMember={props.onRemoveCourseMember}
        />
      </div>
    </section>
  );
}

function PeopleGroup(props: {
  title: string;
  members: CourseMember[];
  mode: "teacher" | "student";
  isLoading: boolean;
  onRemoveCourseMember?: (memberId: number) => void;
}) {
  return (
    <section className="people-group">
      <div className="people-group-heading">
        <h3>{props.title}</h3>
        <span>{props.members.length}</span>
      </div>
      <div className="people-list">
        {props.members.length === 0 ? <p className="muted">Пока никого нет.</p> : null}
        {props.members.map((member) => (
          <div key={member.id} className="people-row">
            <div className="people-avatar">{(member.user.full_name || member.user.email).slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{member.user.full_name || member.user.email}</strong>
              <span>{member.user.email}</span>
            </div>
            {props.mode === "teacher" && props.onRemoveCourseMember ? (
              <button className="danger slim" onClick={() => props.onRemoveCourseMember?.(member.id)} disabled={props.isLoading}>
                Удалить
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}