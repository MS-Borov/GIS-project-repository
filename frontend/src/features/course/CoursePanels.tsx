type CourseTab = "stream" | "assignments" | "submissions" | "layers" | "requirements" | "people";

type Course = {
  id: number;
  title: string;
  description?: string | null;
};

type Assignment = {
  id: number;
  title: string;
  description?: string | null;
};

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
}) {
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
        {props.assignments.map((assignment) => (
          <article
            key={assignment.id}
            className={assignment.id === props.selectedAssignmentId ? "classwork-item active" : "classwork-item"}
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
              </span>
            </button>
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

