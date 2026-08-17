/* global PocketBase */
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const PB_URL = IS_LOCAL ? 'http://127.0.0.1:8090' : 'https://teacherhub-production-c8bf.up.railway.app';
const pb = new PocketBase(PB_URL);
const SOURCE_UPLOAD_LIMIT = 100 * 1024 * 1024;

const el = (id) => document.getElementById(id);
const state = { role: '', route: 'home', navigationId: 0, students: [], student: null, progress: null, homework: null, homeworks: [], tasks: [], result: null, editingStudentId: null, homeworkStudentId: null, pendingWorksheetStudentId: null, questionCount: 0 };
const skills = [
  ['vocabulary', 'Vocabulary', 'V'], ['grammar', 'Grammar', 'G'], ['reading', 'Reading', 'R'],
  ['listening', 'Listening', 'L'], ['speaking', 'Speaking', 'S'],
];

document.addEventListener('DOMContentLoaded', () => {
  el('login-form').addEventListener('submit', login);
  el('logout-button').addEventListener('click', logout);
  window.addEventListener('focus', refreshCurrentActionDraft);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCurrentActionDraft(); });
  if (pb.authStore.isValid) enterApp().catch(handleFatal); else showLogin();
});

async function login(event) {
  event.preventDefault(); setLoading(true); el('login-error').textContent = '';
  try {
    await pb.collection('users').authWithPassword(el('email').value.trim(), el('password').value);
    await enterApp();
  } catch (error) {
    pb.authStore.clear();
    el('login-error').textContent = error?.response?.message || 'Не удалось войти. Проверьте email и пароль.';
  } finally { setLoading(false); }
}

async function enterApp() {
  state.role = pb.authStore.record?.role;
  if (!['teacher', 'parent'].includes(state.role)) throw new Error('Для пользователя не задана роль teacher или parent.');
  el('login-view').classList.add('hidden'); el('workspace').classList.remove('hidden');
  renderShell(); await navigate('home');
}

function showLogin() { el('login-view').classList.remove('hidden'); el('workspace').classList.add('hidden'); }
function logout() { pb.authStore.clear(); Object.assign(state, { role: '', route: 'home', students: [], student: null, progress: null, homework: null, homeworks: [], tasks: [], result: null }); showLogin(); }

function renderShell() {
  const parentItems = [['home', '⌂', 'Главная'], ['homework', '▤', 'Домашнее задание'], ['progress', '⌁', 'Прогресс']];
  const teacherItems = [['home', '⌂', 'Ученики'], ['materials', '▦', 'Материалы'], ['worksheet-builder', '✎', 'Создать worksheet']];
  el('sidebar-nav').innerHTML = (state.role === 'parent' ? parentItems : teacherItems).map(([route, icon, label]) =>
    `<button class="nav-button" data-route="${route}" type="button"><span class="nav-icon">${icon}</span>${label}</button>`).join('');
  el('sidebar-nav').querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.route)));
  const user = pb.authStore.record;
  el('profile-chip').innerHTML = `<div class="avatar">${initials(user.name || user.email)}</div><span>${escapeHtml(user.name || user.email)}</span>`;
}

async function navigate(route) {
  state.route = route; const navigationId = ++state.navigationId; setLoading(true);
  try {
    document.querySelectorAll('[data-route]').forEach((button) => button.classList.toggle('active', button.dataset.route === route || (route === 'task' && button.dataset.route === 'homework')));
    if (state.role === 'teacher' && route === 'materials') { setHeader('Материалы', 'Загрузка библиотеки…', 'Личная библиотека'); el('content').innerHTML = '<section class="card empty-state">Загрузка материалов…</section>'; }
    if (state.role === 'teacher' && route === 'worksheet-builder') { setHeader('Создать worksheet', 'Загрузка Worksheet Builder…', 'Worksheet Builder'); el('content').innerHTML = '<section class="card empty-state">Загрузка worksheet и черновиков…</section>'; }
    if (state.role === 'parent') await loadParentData(); else await loadTeacherData();
    if (navigationId !== state.navigationId) return;
    const teacherRoutes = { materials: renderMaterials, 'worksheet-builder': renderWorksheetBuilder };
    if (state.role === 'teacher' && teacherRoutes[route]) await teacherRoutes[route](navigationId);
    else if (state.role === 'teacher') renderTeacher();
    else if (route === 'task') await renderTask();
    else if (route === 'homework') renderHomeworkOverview();
    else if (route === 'progress') renderProgressPage();
    else renderParentHome();
  } catch (error) { if (navigationId === state.navigationId) { if (state.role === 'teacher' && ['materials', 'worksheet-builder'].includes(route)) el('content').innerHTML = `<section class="card empty-state">Не удалось загрузить раздел. Проверьте подключение к TeacherHub и повторите попытку.</section>`; handleFatal(error); } } finally { if (navigationId === state.navigationId) setLoading(false); }
}

async function loadParentData() {
  state.student = await pb.collection('students').getFirstListItem('', { requestKey: null });
  const [progressResult, homeworkResult, resultsResult] = await Promise.allSettled([
    pb.collection('progress').getFirstListItem(`student="${state.student.id}"`, { requestKey: null }),
    pb.collection('homework').getFullList({
      filter: `student="${state.student.id}" && status="published"`,
      sort: '-due_date',
      expand: 'worksheet',
      requestKey: null,
    }),
    pb.collection('homework_results').getList(1, 1, {
      filter: `student="${state.student.id}"`,
      sort: '-completed_at',
      expand: 'homework',
      requestKey: null,
    }),
  ]);

  state.progress = progressResult.status === 'fulfilled' ? progressResult.value : null;
  state.homeworks = homeworkResult.status === 'fulfilled' ? homeworkResult.value : [];
  state.homework = state.homeworks[0] || null;
  state.result = resultsResult.status === 'fulfilled' ? resultsResult.value.items[0] || null : null;

  if (progressResult.status === 'rejected') console.warn('Progress is unavailable:', progressResult.reason);
  if (homeworkResult.status === 'rejected') console.warn('Homework is unavailable:', homeworkResult.reason);
  if (resultsResult.status === 'rejected') console.warn('Homework results are unavailable:', resultsResult.reason);
}

async function loadTeacherData() {
  state.students = await pb.collection('students').getFullList({ sort: 'name', requestKey: null });
  const [progress, homework, results] = await Promise.all([
    pb.collection('progress').getFullList({ requestKey: null }),
    pb.collection('homework').getFullList({ filter: 'status="published"', sort: '-due_date', requestKey: null }),
    pb.collection('homework_results').getFullList({ sort: '-completed_at', requestKey: null }),
  ]);
  state.teacherData = { progress, homework, results };
}

function setHeader(title, subtitle, kicker = '') { el('page-title').textContent = title; el('page-subtitle').textContent = subtitle; el('page-kicker').textContent = kicker; }

function renderParentHome() {
  const student = state.student; const avg = average(state.progress); const result = state.result;
  setHeader(`Здравствуйте, ${student.name}!`, `Вот как продвигается изучение английского языка.`, student.course || 'English');
  el('content').innerHTML = `<div class="grid summary-grid">
    ${homeworkCard()}
    <section class="card"><div class="card-title"><div class="icon-box">★</div><h2>Средний результат</h2></div><div class="score-value">${avg}<small>%</small></div><p class="muted">по пяти навыкам</p><div class="bar"><div class="bar-fill grammar" data-width="${avg}"></div></div></section>
  </div>
  <section class="card progress-card"><div class="card-title"><h2>Прогресс по навыкам</h2></div>${skillsMarkup(state.progress)}</section>
  <section class="card progress-card"><div class="card-title"><h2>Последний результат ДЗ</h2></div>${result ? `<div class="result-strip"><div><strong>${escapeHtml(result.expand?.homework?.title || 'Домашнее задание')}</strong><p class="muted">Выполнено ${formatDate(result.completed_at, true)}</p></div><div class="result-badge">${result.status === 'needs_review' ? 'На проверке' : `${result.percentage}%`}</div></div>` : '<div class="empty-state">Пока нет результатов</div>'}</section>`;
  bindHomeworkButtons(); animateBars();
}

function homeworkCard() {
  const homeworks = state.homeworks || [];
  if (!homeworks.length) return '<section class="card homework-card"><div class="card-title"><div class="icon-box">✓</div><h2>Домашние задания</h2></div><div class="empty-state">Пока нет домашнего задания</div></section>';
  return `<section class="card homework-card"><div class="card-title"><div class="icon-box">▤</div><h2>Домашние задания</h2></div><div class="homework-list">${homeworks.map((homework) => `<article class="homework-list-item"><div><h3 class="homework-title">${escapeHtml(homework.title)}</h3>${homework.instructions ? `<p class="homework-instructions">${escapeHtml(homework.instructions)}</p>` : ''}<p class="muted">Срок: ${formatDate(homework.due_date, true)} · Опубликовано</p></div><button class="primary-button open-homework" data-homework-id="${homework.id}" type="button">Открыть &nbsp;→</button></article>`).join('')}</div></section>`;
}

function renderHomeworkOverview() {
  setHeader('Домашнее задание', 'Опубликованное задание по текущей теме.', state.student.current_topic || 'English');
  el('content').innerHTML = `<div class="homework-shell">${homeworkCard()}</div>`; bindHomeworkButtons();
}

function renderProgressPage() {
  setHeader('Прогресс', `Результаты ${state.student.name} по пяти языковым навыкам.`, state.student.course || 'English');
  el('content').innerHTML = `<section class="card progress-card"><div class="card-title"><h2>Прогресс по навыкам</h2><strong>${average(state.progress)}% в среднем</strong></div>${skillsMarkup(state.progress)}</section>`; animateBars();
}

async function renderTask() {
  if (!state.homework) return renderHomeworkOverview();
  if (state.homework.worksheet) return renderWorksheetPlayer();
  state.tasks = await pb.collection('homework_tasks').getFullList({ filter: `homework="${state.homework.id}"`, sort: 'order', requestKey: null });
  const ownResult = state.result?.homework === state.homework.id ? state.result : null;
  setHeader(state.homework.title, state.homework.instructions || 'Ответьте на все вопросы и нажмите «Проверить».', `Срок: ${formatDate(state.homework.due_date, true)}`);
  el('content').innerHTML = `<form id="task-form" class="homework-shell">${state.tasks.map(taskMarkup).join('') || '<section class="card empty-state">В задании пока нет вопросов.</section>'}<div class="homework-actions"><button class="primary-button" type="submit" ${state.tasks.length ? '' : 'disabled'}>Проверить</button><button id="back-home" class="secondary-button" type="button">Вернуться</button>${ownResult ? `<strong>Последний результат: ${ownResult.percentage}%</strong>` : ''}</div></form>`;
  el('task-form').addEventListener('submit', checkHomework); el('back-home').addEventListener('click', () => navigate('homework'));
}

function taskMarkup(task, index) {
  const name = `answer-${task.id}`;
  const options = Array.isArray(task.options) ? task.options : [];
  const input = task.task_type === 'multiple_choice' ? options.map((option) => `<label class="option"><input type="radio" name="${name}" value="${escapeAttr(option)}">${escapeHtml(option)}</label>`).join('') : `<input class="text-answer" name="${name}" type="text" autocomplete="off" placeholder="Короткий ответ">`;
  return `<section class="card task-card" data-task="${task.id}"><span class="task-number">ЗАДАНИЕ ${index + 1}</span><h3>${escapeHtml(task.question)}</h3>${input}<p class="feedback"></p></section>`;
}

async function checkHomework(event) {
  event.preventDefault(); let score = 0;
  state.tasks.forEach((task) => {
    const card = document.querySelector(`[data-task="${task.id}"]`); const checked = document.querySelector(`[name="answer-${task.id}"]:checked`);
    const input = task.task_type === 'multiple_choice' ? checked : document.querySelector(`[name="answer-${task.id}"]`);
    const answer = input?.value || ''; const correct = normalize(answer) === normalize(task.correct_answer); if (correct) score += 1;
    card.classList.remove('correct', 'incorrect'); card.classList.add(correct ? 'correct' : 'incorrect');
    card.querySelector('.feedback').textContent = correct ? 'Верно' : `Неверно. Правильный ответ: ${task.correct_answer}`;
  });
  const maxScore = state.tasks.length; const percentage = maxScore ? Math.round(score / maxScore * 100) : 0;
  setLoading(true);
  try {
    const data = { homework: state.homework.id, student: state.student.id, score, max_score: maxScore, percentage, completed_at: new Date().toISOString() };
    const existing = await pb.collection('homework_results').getFirstListItem(`homework="${state.homework.id}" && student="${state.student.id}"`, { requestKey: null }).catch(() => null);
    state.result = existing ? await pb.collection('homework_results').update(existing.id, data) : await pb.collection('homework_results').create(data);
    toast(`Результат сохранён: ${score} из ${maxScore} (${percentage}%)`);
  } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

function renderTeacher() {
  if (state.homeworkStudentId) return renderHomeworkCreator();
  setHeader('Ученики', 'Прогресс, текущее задание и последние результаты.', 'Teacher view');
  const d = state.teacherData;
  el('content').innerHTML = `<section class="card table-card"><div class="card-title"><h2>Ученики</h2><button id="add-student" class="primary-button" type="button">+ Добавить ученика</button></div><table class="student-table"><thead><tr><th>Ученик</th><th>Текущая тема</th><th>Прогресс</th><th>Действия</th><th>Текущее ДЗ</th><th>Последний результат</th></tr></thead><tbody>${state.students.map((student) => {
    const progress = d.progress.find((x) => x.student === student.id); const homeworks = d.homework.filter((x) => x.student === student.id); const result = d.results.find((x) => x.student === student.id);
    const isEditing = state.editingStudentId === student.id;
    return `<tr data-student-row="${student.id}"><td><strong>${escapeHtml(student.name)}</strong><div class="muted">${escapeHtml(student.course || 'English')} · ${escapeHtml(student.level || '—')}</div></td><td>${escapeHtml(student.current_topic || '—')}</td><td>${isEditing ? progressEditor(progress) : teacherProgressMarkup(progress)}</td><td>${isEditing ? `<div class="edit-actions"><button class="primary-button save-progress" data-student-id="${student.id}" type="button">Сохранить</button><button class="secondary-button cancel-progress" type="button">Отмена</button></div>` : `<div class="row-actions"><button class="secondary-button edit-progress" data-student-id="${student.id}" type="button">Изменить прогресс</button></div>`}</td><td>${homeworks.length ? `<div class="teacher-homework-list">${homeworks.map((homework) => `<article><button class="teacher-homework-link" data-homework-id="${homework.id}" type="button">${escapeHtml(homework.title)}</button><div class="homework-preview-actions"><span class="muted">до ${formatDate(homework.due_date)} · ${escapeHtml(homework.status)}</span><button class="secondary-button open-teacher-homework" data-homework-id="${homework.id}" type="button">Открыть</button><button class="danger-button delete-homework" data-homework-id="${homework.id}" type="button">Удалить</button></div></article>`).join('')}</div>` : '—'}</td><td>${result ? teacherResultMarkup(result) : '—'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">Ученики пока не добавлены.</td></tr>'}</tbody></table></section><dialog id="student-dialog"><form id="student-form" class="dialog-form"><div><p class="eyebrow">Новый ученик</p><h2>Добавить ученика</h2></div><label>Имя<input name="name" maxlength="120" autocomplete="off" required></label><p id="student-form-error" class="form-error" role="alert"></p><div class="homework-actions"><button class="primary-button" type="submit">Сохранить</button><button id="cancel-student" class="secondary-button" type="button">Отмена</button></div></form></dialog><dialog id="teacher-worksheet-preview" class="preview-dialog"><div id="teacher-worksheet-preview-content"></div><button id="close-teacher-worksheet-preview" class="secondary-button" type="button">Закрыть предпросмотр</button></dialog>`;
  bindTeacherProgressControls(); document.querySelectorAll('.teacher-homework-link, .open-teacher-homework').forEach((button) => button.addEventListener('click', () => openTeacherHomeworkPreview(button.dataset.homeworkId))); document.querySelectorAll('.delete-homework').forEach((button) => button.addEventListener('click', () => deleteStudentHomework(button.dataset.homeworkId))); el('add-student').addEventListener('click', () => el('student-dialog').showModal()); el('cancel-student').addEventListener('click', () => el('student-dialog').close()); el('student-form').addEventListener('submit', saveStudent); el('close-teacher-worksheet-preview').addEventListener('click', () => el('teacher-worksheet-preview').close()); animateBars();
}

async function deleteStudentHomework(homeworkId) {
  const homework = state.teacherData.homework.find((item) => item.id === homeworkId);
  if (!homework || !window.confirm(`Удалить homework «${homework.title}»? Worksheet и упражнения останутся.`)) return;
  setLoading(true);
  try {
    const [results, tasks] = await Promise.all([
      pb.collection('homework_results').getList(1, 1, { filter: `homework="${homeworkId}"`, requestKey: null }),
      pb.collection('homework_tasks').getList(1, 1, { filter: `homework="${homeworkId}"`, requestKey: null }),
    ]);
    if (results.totalItems) { toast('Удаление остановлено: у homework есть результаты ученика.'); return; }
    if (tasks.totalItems) { toast('Удаление остановлено: у homework есть связанные задания старого формата.'); return; }
    await pb.collection('homework').delete(homeworkId);
    state.teacherData.homework = state.teacherData.homework.filter((item) => item.id !== homeworkId); renderTeacher(); toast('Homework удалено. Worksheet сохранён.');
  } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

async function openTeacherHomeworkPreview(homeworkId) {
  const homework = state.teacherData.homework.find((item) => item.id === homeworkId);
  if (!homework) { toast('Домашнее задание не найдено.'); return; }
  if (!homework.worksheet) { toast('У этого homework не указан связанный worksheet.'); return; }
  setLoading(true);
  try {
    const [worksheet, exercises] = await Promise.all([
      pb.collection('worksheets').getOne(homework.worksheet, { requestKey: null }),
      pb.collection('worksheet_exercises').getFullList({ filter: `worksheet="${homework.worksheet}"`, sort: 'order', requestKey: null }),
    ]);
    if (worksheet.status !== 'published') { toast('Связанный worksheet ещё не опубликован.'); return; }
    const content = el('teacher-worksheet-preview-content'); content.innerHTML = worksheetPageMarkup(worksheet, exercises, true); bindWorksheetInteractions(content); el('teacher-worksheet-preview').showModal();
  } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

async function openBuilderPublishedPreview(worksheetId) {
  setLoading(true);
  try {
    const [worksheet, exercises] = await Promise.all([
      pb.collection('worksheets').getOne(worksheetId, { requestKey: null }),
      pb.collection('worksheet_exercises').getFullList({ filter: `worksheet="${worksheetId}"`, sort: 'order', requestKey: null }),
    ]);
    const content = el('worksheet-preview-content'); content.innerHTML = worksheetPageMarkup(worksheet, exercises, true); bindWorksheetInteractions(content); el('worksheet-preview-dialog').showModal();
  } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

async function saveStudent(event) {
  event.preventDefault(); const form = event.currentTarget, name = form.elements.name.value.trim(), errorElement = el('student-form-error'); errorElement.textContent = '';
  if (!name) { errorElement.textContent = 'Введите имя ученика.'; return; }
  form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try { const student = await pb.collection('students').create({ name }); state.students.push(student); state.students.sort((a, b) => a.name.localeCompare(b.name, 'ru')); renderTeacher(); toast('Ученик добавлен'); }
  catch (error) { console.error(error); errorElement.textContent = error?.response?.data?.name?.message || error?.response?.message || error.message || 'Не удалось добавить ученика.'; form.querySelectorAll('button').forEach((button) => { button.disabled = false; }); }
}

function teacherResultMarkup(result) { const answers = Array.isArray(result.open_answers) ? result.open_answers : []; if (result.status !== 'needs_review') return `<strong>${result.percentage}%</strong><div class="muted">${formatDate(result.completed_at)}</div>`; return `<strong class="review-status">Ожидает проверки</strong>${Number(result.max_score) ? `<div class="muted">Автопроверка: ${result.percentage}%</div>` : ''}<div class="muted">${formatDate(result.completed_at)}</div>${answers.map((item, index) => `<details class="review-answer"><summary>Открытый ответ ${index + 1}</summary><strong>${escapeHtml(item.prompt || 'Ответ ученика')}</strong><p>${escapeHtml(item.answer || '')}</p></details>`).join('')}`; }

function teacherProgressMarkup(progress) {
  return `<div class="mini-skills">${skills.map(([key, label]) => { const value = Number(progress?.[key] || 0); return `<div class="mini-skill"><span>${label}</span><div class="bar"><div class="bar-fill ${key}" data-width="${value}"></div></div><b>${value}%</b></div>`; }).join('')}</div>`;
}

function progressEditor(progress) {
  const values = [0, 25, 50, 75, 100];
  return `<div class="progress-editor">${skills.map(([key, label]) => { const current = Number(progress?.[key] || 0); return `<label><span>${label}</span><select name="${key}">${values.map((value) => `<option value="${value}" ${value === current ? 'selected' : ''}>${value}%</option>`).join('')}</select></label>`; }).join('')}</div>`;
}

function bindTeacherProgressControls() {
  document.querySelectorAll('.edit-progress').forEach((button) => button.addEventListener('click', () => { state.editingStudentId = button.dataset.studentId; renderTeacher(); }));
  document.querySelectorAll('.cancel-progress').forEach((button) => button.addEventListener('click', () => { state.editingStudentId = null; renderTeacher(); }));
  document.querySelectorAll('.save-progress').forEach((button) => button.addEventListener('click', () => saveStudentProgress(button)));
  document.querySelectorAll('.create-homework').forEach((button) => button.addEventListener('click', () => {
    state.homeworkStudentId = null; state.pendingWorksheetStudentId = button.dataset.studentId; state.questionCount = 0; navigate('worksheet-builder');
  }));
}

function renderHomeworkCreator() {
  const student = state.students.find((item) => item.id === state.homeworkStudentId);
  if (!student) { state.homeworkStudentId = null; return renderTeacher(); }
  setHeader('Создать домашнее задание', `Ученик: ${student.name}`, student.current_topic || student.course || 'English');
  el('content').innerHTML = `<form id="homework-create-form" class="homework-creator card">
    <div class="form-grid">
      <label>Ученик<input type="text" value="${escapeAttr(student.name)}" disabled></label>
      <label>Название ДЗ<input name="title" type="text" maxlength="180" required></label>
      <label class="full-field">Инструкция<textarea name="instructions" rows="3" maxlength="2000"></textarea></label>
      <label>Срок сдачи<input name="due_date" type="datetime-local"></label>
      <label>Статус<input type="text" value="Черновик" disabled></label>
    </div>
    <div class="questions-heading"><div><h2>Вопросы</h2><p class="muted">Добавьте задания с однозначной автопроверкой.</p></div><button id="add-question" class="secondary-button" type="button">+ Добавить вопрос</button></div>
    <div id="question-list"></div>
    <p id="homework-form-error" class="form-error" role="alert"></p>
    <div class="homework-actions"><button class="secondary-button save-homework" data-status="draft" type="submit">Сохранить черновик</button><button class="primary-button save-homework" data-status="published" type="submit">Опубликовать</button><button id="cancel-homework" class="secondary-button" type="button">Отмена</button></div>
  </form>`;
  el('add-question').addEventListener('click', addQuestionEditor);
  el('cancel-homework').addEventListener('click', closeHomeworkCreator);
  el('homework-create-form').addEventListener('submit', saveHomework);
  addQuestionEditor();
}

function addQuestionEditor() {
  const index = state.questionCount++;
  const wrapper = document.createElement('section'); wrapper.className = 'question-editor'; wrapper.dataset.questionIndex = index;
  wrapper.innerHTML = `<div class="question-editor-head"><strong>Вопрос ${index + 1}</strong><button class="remove-question" type="button" aria-label="Удалить вопрос">Удалить</button></div>
    <label>Тип<select name="task_type"><option value="multiple_choice">Multiple choice</option><option value="text_input">Text input</option></select></label>
    <label>Вопрос<textarea name="question" rows="2" required></textarea></label>
    <div class="choice-fields">${[1,2,3,4].map((number) => `<label>Вариант ${number}<input name="option_${number}" type="text" required></label>`).join('')}<label>Правильный вариант<select name="correct_option">${[1,2,3,4].map((number) => `<option value="${number}">Вариант ${number}</option>`).join('')}</select></label></div>
    <label class="text-correct hidden">Правильный короткий ответ<input name="correct_text" type="text"></label>`;
  el('question-list').appendChild(wrapper);
  wrapper.querySelector('[name="task_type"]').addEventListener('change', (event) => toggleQuestionType(wrapper, event.target.value));
  wrapper.querySelector('.remove-question').addEventListener('click', () => wrapper.remove());
}

function toggleQuestionType(wrapper, type) {
  const isChoice = type === 'multiple_choice';
  wrapper.querySelector('.choice-fields').classList.toggle('hidden', !isChoice);
  wrapper.querySelector('.text-correct').classList.toggle('hidden', isChoice);
  wrapper.querySelectorAll('.choice-fields input').forEach((input) => { input.required = isChoice; });
  wrapper.querySelector('[name="correct_text"]').required = !isChoice;
}

function closeHomeworkCreator() { state.homeworkStudentId = null; state.questionCount = 0; renderTeacher(); }

async function saveHomework(event) {
  event.preventDefault();
  const submitter = event.submitter; const status = submitter?.dataset.status || 'draft';
  const form = event.currentTarget; const editors = [...form.querySelectorAll('.question-editor')];
  el('homework-form-error').textContent = '';
  if (!editors.length) { el('homework-form-error').textContent = 'Добавьте хотя бы один вопрос.'; return; }
  const tasks = editors.map((editor, order) => readQuestionEditor(editor, order));
  if (tasks.some((task) => !task)) { el('homework-form-error').textContent = 'Заполните все поля вопросов.'; return; }
  form.querySelectorAll('button').forEach((button) => { button.disabled = true; }); setLoading(true);
  try {
    const dueValue = form.elements.due_date.value;
    const homework = await pb.collection('homework').create({
      student: state.homeworkStudentId, title: form.elements.title.value.trim(), instructions: form.elements.instructions.value.trim(),
      due_date: dueValue ? new Date(dueValue).toISOString() : '', status: 'draft', created_by: pb.authStore.record.id,
    });
    for (const task of tasks) await pb.collection('homework_tasks').create({ ...task, homework: homework.id });
    const saved = status === 'published' ? await pb.collection('homework').update(homework.id, { status: 'published' }) : homework;
    state.teacherData.homework.unshift(saved); state.homeworkStudentId = null; state.questionCount = 0; renderTeacher();
    toast(status === 'published' ? 'Домашнее задание опубликовано' : 'Черновик сохранён');
  } catch (error) { handleFatal(error); form.querySelectorAll('button').forEach((button) => { button.disabled = false; }); } finally { setLoading(false); }
}

function readQuestionEditor(editor, order) {
  const type = editor.querySelector('[name="task_type"]').value; const question = editor.querySelector('[name="question"]').value.trim();
  if (!question) return null;
  if (type === 'text_input') {
    const answer = editor.querySelector('[name="correct_text"]').value.trim();
    return answer ? { question, task_type: type, options: [], correct_answer: answer, order } : null;
  }
  const options = [1,2,3,4].map((number) => editor.querySelector(`[name="option_${number}"]`).value.trim());
  if (options.some((option) => !option)) return null;
  const correctIndex = Number(editor.querySelector('[name="correct_option"]').value) - 1;
  return { question, task_type: type, options, correct_answer: options[correctIndex], order };
}

async function saveStudentProgress(button) {
  const studentId = button.dataset.studentId;
  const row = document.querySelector(`[data-student-row="${studentId}"]`);
  const data = { student: studentId };
  skills.forEach(([key]) => { data[key] = Number(row.querySelector(`[name="${key}"]`).value); });
  button.disabled = true; setLoading(true);
  try {
    let record = state.teacherData.progress.find((item) => item.student === studentId);
    if (!record) record = await pb.collection('progress').getFirstListItem(`student="${studentId}"`, { requestKey: null }).catch(() => null);
    const saved = record ? await pb.collection('progress').update(record.id, data) : await pb.collection('progress').create(data);
    const index = state.teacherData.progress.findIndex((item) => item.student === studentId);
    if (index >= 0) state.teacherData.progress[index] = saved; else state.teacherData.progress.push(saved);
    state.editingStudentId = null; renderTeacher(); toast('Прогресс сохранён');
  } catch (error) { handleFatal(error); button.disabled = false; } finally { setLoading(false); }
}

async function renderMaterials(navigationId = state.navigationId) {
  const materials = await pb.collection('materials').getFullList({ sort: 'title', requestKey: null });
  if (navigationId !== state.navigationId || state.route !== 'materials') return;
  setHeader('Материалы', 'Файлы для подготовки интерактивных рабочих листов.', 'Личная библиотека');
  el('content').innerHTML = `<div class="materials-layout"><form id="material-form" class="card material-form"><div class="card-title"><h2>Добавить материал</h2></div><label>Название<input name="title" required></label><label>Файл<input name="file" type="file" required accept=".pdf,.doc,.docx,.ppt,.pptx,image/jpeg,image/png"></label><button class="primary-button" type="submit">Добавить в библиотеку</button></form>
    <section class="grid material-list">${materials.map((material) => `<article class="card material-card"><p class="eyebrow">${escapeHtml(materialFileType(material.file))}</p><h2>${escapeHtml(material.title)}</h2><p class="muted file-name">${escapeHtml(material.file || 'Файл не загружен')}</p><div class="material-actions">${material.file ? `<a class="secondary-button" href="${escapeAttr(pb.files.getURL(material, material.file))}" target="_blank" rel="noopener">Открыть</a>` : ''}<button class="secondary-button rename-material" data-id="${material.id}" data-title="${escapeAttr(material.title)}" type="button">Переименовать</button><label class="secondary-button replace-file">Заменить файл<input data-id="${material.id}" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,image/jpeg,image/png"></label><button class="danger-button delete-material" data-id="${material.id}" type="button">Удалить</button></div></article>`).join('') || '<div class="card empty-state">В библиотеке пока нет материалов.</div>'}</section></div>`;
  el('material-form').addEventListener('submit', saveMaterial);
  document.querySelectorAll('.rename-material').forEach((button) => button.addEventListener('click', () => renameMaterial(button)));
  document.querySelectorAll('.replace-file input').forEach((input) => input.addEventListener('change', () => replaceMaterialFile(input)));
  document.querySelectorAll('.delete-material').forEach((button) => button.addEventListener('click', () => deleteMaterial(button.dataset.id)));
}

async function saveMaterial(event) {
  event.preventDefault(); const form = event.currentTarget, file = form.elements.file.files[0]; if (file?.size > SOURCE_UPLOAD_LIMIT) { toast('Максимальный размер файла — 100 МБ'); return; } const data = new FormData();
  data.set('title', form.elements.title.value.trim()); data.set('created_by', pb.authStore.record.id); data.set('file', file);
  setLoading(true); try { await pb.collection('materials').create(data); toast('Материал добавлен'); await renderMaterials(); } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

function materialFileType(file) { const extension = String(file || '').split('.').pop().toUpperCase(); return extension || 'Документ'; }
async function renameMaterial(button) { const title = window.prompt('Новое название материала', button.dataset.title); if (!title?.trim()) return; setLoading(true); try { await pb.collection('materials').update(button.dataset.id, { title: title.trim() }); toast('Материал переименован'); await renderMaterials(); } catch (error) { handleFatal(error); } finally { setLoading(false); } }
async function replaceMaterialFile(input) { if (!input.files[0]) return; if (input.files[0].size > SOURCE_UPLOAD_LIMIT) { toast('Максимальный размер файла — 100 МБ'); input.value = ''; return; } const data = new FormData(); data.set('file', input.files[0]); setLoading(true); try { await pb.collection('materials').update(input.dataset.id, data); toast('Файл заменён'); await renderMaterials(); } catch (error) { handleFatal(error); } finally { setLoading(false); } }
async function deleteMaterial(id) { if (!window.confirm('Удалить материал? Это действие нельзя отменить.')) return; setLoading(true); try { const [sources, worksheets] = await Promise.all([pb.collection('worksheet_sources').getList(1, 1, { filter: `material="${id}"`, requestKey: null }), pb.collection('worksheets').getList(1, 1, { filter: `source_material="${id}"`, requestKey: null })]); if (sources.totalItems || worksheets.totalItems) { toast('Материал используется в worksheet. Сначала отвяжите его.'); return; } await pb.collection('materials').delete(id); toast('Материал удалён'); await renderMaterials(); } catch (error) { handleFatal(error); } finally { setLoading(false); } }

async function renderWorksheetBuilder(navigationId = state.navigationId) {
  const [materials, sections, worksheets] = await Promise.all([pb.collection('materials').getFullList({ sort: 'title', requestKey: null }), pb.collection('material_sections').getFullList({ sort: 'order', requestKey: null }), pb.collection('worksheets').getFullList({ requestKey: null })]);
  if (navigationId !== state.navigationId || state.route !== 'worksheet-builder') return;
  const drafts = worksheets.filter((worksheet) => worksheet.status === 'draft');
  state.builderMaterials = materials; state.builderSections = sections; state.builderDrafts = drafts; state.questionCount = 0; state.editingWorksheet = null; state.editingHomework = null; state.editingSources = []; state.previewExercises = null; state.sourceMetadata = {};
  setHeader('Создать worksheet', 'Интерактивный рабочий лист для ученика.', 'Worksheet Builder');
  el('content').innerHTML = `<section class="drafts-panel card"><div class="card-title"><h2>Existing drafts</h2><span id="draft-count">${drafts.length}</span></div><div class="draft-list">${drafts.map(draftListMarkup).join('') || '<p class="muted drafts-empty">Черновиков пока нет.</p>'}</div></section><form id="worksheet-form" class="worksheet-builder card" novalidate><section class="builder-step"><span>Шаг 1</span><h2>Ученик</h2><select name="student"><option value="">Без привязки к ученику</option>${state.students.map((student) => `<option value="${student.id}">${escapeHtml(student.name)}</option>`).join('')}</select>${state.students.length ? '' : '<p class="muted">Ученики пока не добавлены.</p>'}</section>
    <section class="builder-step"><span>Шаг 2</span><h2>Параметры worksheet</h2><div class="form-grid"><label class="full-field" for="work-goal">Что отработать<textarea id="work-goal" name="work_goal" rows="4" required placeholder="he/she + is/isn't, вопросы Is he...? Is she...? и adjectives big, small, happy, sad"></textarea></label><label class="full-field">Вводный текст для ученика<textarea name="intro_text" rows="7" placeholder="Read first.&#10;&#10;Jack:&#10;I am small."></textarea></label><label for="worksheet-title">Название worksheet<input id="worksheet-title" name="worksheet_title" required placeholder="Present Simple"></label><label>Примерное время<input name="estimated_time" placeholder="20 минут"></label><label>Срок<input name="due_date" type="datetime-local"></label></div></section>
    <section class="builder-step"><span>Шаг 3</span><h2>Источники</h2><p class="muted">Можно одновременно выбрать несколько материалов и загрузить несколько файлов.</p><div class="source-picker"><div><strong>Из библиотеки</strong><div class="library-checklist">${materials.map((m) => `<label><input type="checkbox" name="library_sources" value="${m.id}"> ${escapeHtml(m.title)}</label>`).join('') || '<div class="materials-empty"><p class="muted">В библиотеке пока нет материалов. Сначала добавьте материал.</p><button id="go-materials" class="secondary-button" type="button">Перейти в материалы</button></div>'}</div></div><label>Страницы / сканы<input name="source_files" type="file" multiple accept="image/jpeg,image/png,application/pdf"></label></div><div id="selected-sources" class="selected-sources"><span class="muted">Источники не выбраны</span></div></section>
    <section class="agent-launch builder-agent"><div><h2>Создать worksheet в AI-агенте</h2><p class="muted">Агент создаст worksheet по выбранным параметрам и материалам. После сохранения черновик появится в TeacherHub.</p></div><div class="agent-actions"><button id="copy-agent-prompt" class="secondary-button" type="button">Скопировать промпт для агента</button><a class="secondary-button" href="https://chatgpt.com/g/g-6a7f6d14a6c4819199f2014e5a233cfc-teacherhub-worksheet-builder" target="_blank" rel="noopener noreferrer">Открыть AI-агента</a></div></section>
    <section id="review-section" class="builder-step"><span>Шаг 4</span><div class="questions-heading"><div><h2>Упражнения</h2><p class="muted">Проверьте готовый worksheet перед публикацией.</p></div><button id="add-exercise" class="secondary-button" type="button">+ Добавить упражнение вручную</button></div><div class="review-toolbar"><button id="refresh-action-draft" class="secondary-button" type="button">Обновить draft</button><button id="preview-worksheet" class="secondary-button" type="button">Предпросмотр как ученик</button><strong id="draft-sync-status" class="draft-sync-status"></strong></div><div id="exercise-list"></div></section>
    <p id="worksheet-error" class="form-error"></p><div id="publish-actions" class="homework-actions"><button class="secondary-button" data-status="draft" type="submit">Сохранить черновик</button><button class="primary-button" data-status="published" type="submit">Опубликовать</button><button id="cancel-worksheet" class="secondary-button" type="button">Отмена</button></div><div id="publish-result" class="publish-result" aria-live="polite"></div></form><dialog id="worksheet-preview-dialog" class="preview-dialog"><div id="worksheet-preview-content"></div><button id="close-preview" class="secondary-button" type="button">Закрыть предпросмотр</button></dialog>`;
  document.querySelectorAll('[name="library_sources"]').forEach((checkbox) => checkbox.addEventListener('change', updateSelectedSources));
  document.querySelectorAll('.open-draft').forEach((button) => button.addEventListener('click', () => openWorksheetDraft(button.dataset.draftId)));
  document.querySelectorAll('.delete-draft').forEach((button) => button.addEventListener('click', () => deleteWorksheetDraft(button.dataset.draftId)));
  el('go-materials')?.addEventListener('click', () => navigate('materials'));
  el('worksheet-form').elements.source_files.addEventListener('change', updateSelectedSources);
  el('copy-agent-prompt').addEventListener('click', copyAgentPrompt);
  el('refresh-action-draft').addEventListener('click', () => refreshCurrentActionDraft(true));
  el('add-exercise').addEventListener('click', () => addWorksheetExercise(null, true)); el('cancel-worksheet').addEventListener('click', () => navigate('home')); el('worksheet-form').addEventListener('submit', saveWorksheet);
  el('preview-worksheet').addEventListener('click', showBuilderPreview); el('close-preview').addEventListener('click', () => el('worksheet-preview-dialog').close());
  if (state.pendingWorksheetStudentId) { el('worksheet-form').elements.student.value = state.pendingWorksheetStudentId; state.pendingWorksheetStudentId = null; }
  renderExerciseEmptyState();
}

function draftListMarkup(draft) { const student = state.students.find((item) => item.id === draft.student); return `<article class="draft-item" data-draft-id="${draft.id}"><div class="draft-copy"><strong>${escapeHtml(draft.title || 'Без названия')}</strong><span>${escapeHtml(draft.focus || draft.instructions || 'Черновик')}</span>${student ? `<small>${escapeHtml(student.name)}</small>` : ''}<small>Worksheet ID: ${escapeHtml(draft.id)}</small></div><div class="draft-actions"><button class="secondary-button open-draft" data-draft-id="${draft.id}" type="button">Open</button><button class="danger-button delete-draft" data-draft-id="${draft.id}" type="button" aria-label="Удалить ${escapeAttr(draft.title || 'черновик')}">Delete</button></div></article>`; }
function worksheetTitleValue(form = el('worksheet-form')) { const visibleTitle = form?.querySelector('#worksheet-title'); const currentValue = visibleTitle ? visibleTitle.value.trim() : ''; return currentValue || String(state.editingWorksheet?.title || '').trim(); }

async function deleteWorksheetDraft(id) {
  if (!window.confirm('Удалить этот черновик?\nЭто действие нельзя отменить.')) return;
  setLoading(true);
  try {
    await pb.send(`/api/teacherhub/worksheet-drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.builderDrafts = state.builderDrafts.filter((draft) => draft.id !== id);
    document.querySelector(`.draft-item[data-draft-id="${id}"]`)?.remove();
    el('draft-count').textContent = state.builderDrafts.length;
    const list = document.querySelector('.draft-list'); if (!state.builderDrafts.length) list.innerHTML = '<p class="muted drafts-empty">Черновиков пока нет.</p>';
    toast('Черновик удалён');
    if (state.editingWorksheet?.id === id) await renderWorksheetBuilder();
  } catch (error) { console.error(error); toast(error?.response?.error || error?.message || 'Не удалось удалить черновик'); } finally { setLoading(false); }
}

function renderExerciseEmptyState() { const list = el('exercise-list'); if (list && !list.querySelector('.exercise-editor')) list.innerHTML = '<div class="exercise-empty empty-state">Упражнения появятся здесь после создания worksheet в AI-агенте.</div>'; }

function buildAgentPrompt() {
  const form = el('worksheet-form'), lines = [];
  const studentOption = form.elements.student.selectedOptions[0];
  const values = [
    ['Worksheet ID', state.editingWorksheet?.id || ''],
    ['Student', form.elements.student.value ? studentOption?.textContent.trim() : ''],
    ['Student ID', form.elements.student.value],
    ['Название', worksheetTitleValue(form)],
    ['Что отработать', form.elements.work_goal.value.trim()],
    ['Время', form.elements.estimated_time.value.trim()],
    ['Срок', form.elements.due_date.value],
  ];
  values.forEach(([label, value]) => { if (value) lines.push(`${label}: ${value}`); });
  rememberSourceMetadata();
  const sources = [...form.querySelectorAll('.source-metadata')].map((source) => { const metadata = sourceMetadataFromRow(source), details = ['SOURCE:', `Material: ${source.dataset.sourceLabel}`]; metadata.page_selections.forEach((selection) => { details.push(`Page: ${selection.page}`); if (selection.exercises) details.push(`Exercises: ${selection.exercises}`); }); return details.join('\n'); });
  if (sources.length) lines.push(sources.join('\n\n'));
  lines.unshift('Создай интерактивный worksheet для TeacherHub.');
  lines.push(`Используй точное Page Description этого material + page из Knowledge.

Если указаны конкретные exercises — используй только их.
Не используй соседние страницы или похожие упражнения.
Соблюдай TEXT FACTS, VISUALS, EXPLICIT LINKS и DO NOT INFER.

Если exact Page Description в Knowledge отсутствует — скажи об этом и не придумывай содержание.

Если исходное упражнение зависит от изображения, которое нельзя показать ученику, перепроектируй его так, чтобы Student Version работала без технического описания картинки, либо не используй этот item.

Создай:
INTERACTIVE WORKSHEET DRAFT
+ Teacher Key
+ QA.

Не сохраняй worksheet в TeacherHub до подтверждения преподавателя.`);
  return lines.join('\n\n');
}
async function copyAgentPrompt() {
  setLoading(true); try { await ensureAgentWorksheetDraft(); } catch (error) { handleFatal(error); return; } finally { setLoading(false); }
  const prompt = buildAgentPrompt();
  try { await navigator.clipboard.writeText(prompt); }
  catch (_) { const textarea = document.createElement('textarea'); textarea.value = prompt; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); const copied = document.execCommand('copy'); textarea.remove(); if (!copied) { toast('Не удалось скопировать промпт.'); return; } }
  toast('Промпт скопирован. Откройте AI-агента и вставьте его в чат.');
}

function sourceMetadataFromRow(row) { return { page_selections: [...row.querySelectorAll('.page-selection')].map((selection) => ({ page: selection.querySelector('[name="source_page"]').value.trim(), exercises: selection.querySelector('[name="source_page_exercises"]').value.trim() })).filter((selection) => selection.page), unit: row.querySelector('[name="source_unit"]').value.trim(), teacher_note: row.querySelector('[name="source_note"]').value.trim() }; }
function rememberSourceMetadata() { document.querySelectorAll('.source-metadata').forEach((row) => { state.sourceMetadata[row.dataset.sourceKey] = sourceMetadataFromRow(row); }); }
function pageSelectionMarkup(selection = {}) { return `<div class="page-selection"><label>Страница<input name="source_page" value="${escapeAttr(selection.page || '')}" placeholder="39"></label><label>Упражнения<input name="source_page_exercises" value="${escapeAttr(selection.exercises || '')}" placeholder="1, 2"></label><button class="danger-button remove-page-selection" type="button">Удалить</button></div>`; }
function normalizedPageSelections(metadata = {}) { if (Array.isArray(metadata.page_selections) && metadata.page_selections.length) return metadata.page_selections; if (metadata.pages || metadata.exercises) return [{ page: metadata.pages || '', exercises: metadata.exercises || '' }]; return []; }
function sourceMetadataMarkup(item) { const metadata = state.sourceMetadata[item.key] || {}, selections = normalizedPageSelections(metadata); return `<article class="source-metadata" data-source-key="${escapeAttr(item.key)}" data-source-label="${escapeAttr(item.label)}"><div class="source-metadata-title"><span class="source-chip">${item.type === 'library' ? '▦' : '↥'} ${escapeHtml(item.label)}</span><small>Параметры этого worksheet</small></div><label>Unit / section<input name="source_unit" value="${escapeAttr(metadata.unit || '')}" placeholder="Unit 4 Composition Practice"></label><div class="page-selections">${selections.map(pageSelectionMarkup).join('')}</div><button class="secondary-button add-page-selection" type="button">+ Добавить страницу</button><label>Teacher note<textarea name="source_note" rows="3" placeholder="Методические ограничения для этого источника">${escapeHtml(metadata.teacher_note || '')}</textarea></label></article>`; }
function bindSourceMetadataControls() { document.querySelectorAll('.source-metadata').forEach((source) => { const bindRemove = (button) => button.addEventListener('click', () => button.closest('.page-selection').remove()); source.querySelectorAll('.remove-page-selection').forEach(bindRemove); source.querySelector('.add-page-selection').addEventListener('click', () => { const wrapper = document.createElement('div'); wrapper.innerHTML = pageSelectionMarkup(); const selection = wrapper.firstElementChild; source.querySelector('.page-selections').appendChild(selection); bindRemove(selection.querySelector('.remove-page-selection')); }); }); }
function updateSelectedSources() { const form = el('worksheet-form'); rememberSourceMetadata(); const selected = [...form.querySelectorAll('[name="library_sources"]:checked')].map((input) => ({ type: 'library', id: input.value, key: `library-${input.value}`, label: state.builderMaterials.find((m) => m.id === input.value)?.title || 'Материал' })); const savedUploads = (state.editingSources || []).filter((source) => source.source_type === 'upload').map((source) => ({ type: 'upload', id: source.id, key: `saved-${source.id}`, label: source.uploaded_file || 'Загруженный файл' })); const uploads = [...form.elements.source_files.files].map((file, index) => ({ type: 'upload', key: `upload-${index}`, label: file.name })); const items = [...selected, ...savedUploads, ...uploads]; el('selected-sources').innerHTML = items.length ? items.map(sourceMetadataMarkup).join('') : '<span class="muted">Источники не выбраны</span>'; bindSourceMetadataControls(); }

function answerList(value) { if (Array.isArray(value)) return value.map((item) => String(item)); if (value === null || value === undefined || value === '') return []; return [String(value)]; }
function normalizeDraftExercise(record) {
  const content = record.content && typeof record.content === 'object' ? record.content : {};
  const question = String(content.question || content.prompt_text || '').trim();
  const instruction = [record.instruction, question && question !== record.instruction ? question : ''].filter(Boolean).join(' ');
  let correctAnswer = record.correct_answer ?? content.correct_answer ?? null;
  if (record.type === 'multiple_choice') correctAnswer = answerList(correctAnswer);
  if (record.type === 'text_input') correctAnswer = [...new Set([...answerList(correctAnswer), ...answerList(content.answer), ...answerList(content.acceptable_answers)])];
  if (record.type === 'reorder_words') correctAnswer = Array.isArray(correctAnswer) ? correctAnswer : (content.correct_sequence || content.words || answerList(correctAnswer));
  if (record.type === 'matching' && (!correctAnswer || Array.isArray(correctAnswer))) correctAnswer = Object.fromEntries((content.pairs || []).map((pair) => [pair.left, pair.right]));
  if (record.type === 'dropdown' && !content.items && Array.isArray(content.sentences)) content.items = content.sentences;
  return { ...record, _recordId: record.id, instruction, content, correct_answer: correctAnswer };
}
function datetimeLocalValue(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

async function openWorksheetDraft(id, freshDraft = null) {
  setLoading(true);
  try {
    const draft = freshDraft || state.builderDrafts.find((item) => item.id === id) || await pb.collection('worksheets').getOne(id, { requestKey: null });
    const [exerciseRecords, sources, homeworkResult] = await Promise.all([
      pb.collection('worksheet_exercises').getFullList({ filter: `worksheet="${id}"`, sort: 'order', requestKey: null }),
      pb.collection('worksheet_sources').getFullList({ filter: `worksheet="${id}"`, sort: 'order', requestKey: null }),
      pb.collection('homework').getList(1, 1, { filter: `worksheet="${id}"`, sort: '-created', requestKey: null }).catch(() => ({ items: [] })),
    ]);
    state.editingWorksheet = draft; state.editingSources = sources; state.editingHomework = homeworkResult.items[0] || null; state.editingExerciseIds = exerciseRecords.map((record) => record.id); state.previewExercises = exerciseRecords; state.sourceMetadata = Object.fromEntries(sources.map((source) => [source.source_type === 'library' ? `library-${source.material}` : `saved-${source.id}`, source.metadata || {}]));
    const form = el('worksheet-form'); form.elements.student.value = draft.student || state.editingHomework?.student || ''; form.elements.worksheet_title.value = draft.title || ''; form.elements.work_goal.value = draft.instructions || draft.focus || ''; form.elements.intro_text.value = draft.intro_text || ''; form.elements.estimated_time.value = draft.estimated_time || ''; form.elements.due_date.value = datetimeLocalValue(draft.due_date || state.editingHomework?.due_date);
    form.querySelectorAll('[name="library_sources"]').forEach((input) => { input.checked = sources.some((source) => source.source_type === 'library' && source.material === input.value); });
    el('exercise-list').innerHTML = ''; state.questionCount = 0; exerciseRecords.map(normalizeDraftExercise).forEach((exercise) => addWorksheetExercise(exercise)); if (!exerciseRecords.length) renderExerciseEmptyState();
    updateSelectedSources(); setHeader('Редактировать worksheet', 'Проверьте черновик и внесите необходимые изменения.', 'Worksheet Builder'); document.querySelectorAll('.draft-item').forEach((button) => button.classList.toggle('active', button.dataset.draftId === id)); form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

async function refreshCurrentActionDraft(manual = false) {
  if (state.role !== 'teacher' || state.route !== 'worksheet-builder' || !state.editingWorksheet?.id || state.draftRefreshRunning) return;
  state.draftRefreshRunning = true;
  try {
    const currentId = state.editingWorksheet.id;
    const fresh = await pb.collection('worksheets').getOne(currentId, { requestKey: null });
    if (fresh.status !== 'draft') return;
    const changed = fresh.updated !== state.editingWorksheet.updated;
    if (!changed && !manual) return;
    const draftIndex = state.builderDrafts.findIndex((item) => item.id === currentId); if (draftIndex >= 0) state.builderDrafts[draftIndex] = fresh; else state.builderDrafts.unshift(fresh);
    await openWorksheetDraft(currentId, fresh);
    const status = el('draft-sync-status'); if (status) status.textContent = 'Draft получен из TeacherHub';
    toast(changed ? 'Draft получен из TeacherHub' : 'Draft уже актуален');
  } catch (error) { if (manual) handleFatal(error); else console.warn('Draft refresh is unavailable:', error); } finally { state.draftRefreshRunning = false; }
}

function addWorksheetExercise(exercise = null, manual = false) {
  if (!exercise && !manual) { renderExerciseEmptyState(); return; }
  el('exercise-list').querySelector('.exercise-empty')?.remove();
  const index = state.questionCount++; const node = document.createElement('section'); node.className = 'exercise-editor'; node.dataset.exerciseIndex = index;
  node.innerHTML = `<div class="question-editor-head"><strong>Блок ${index + 1}</strong><div><button class="move-exercise" data-direction="up" type="button">↑</button><button class="move-exercise" data-direction="down" type="button">↓</button><button class="remove-question" type="button">Удалить</button></div></div><div class="exercise-summary"></div><div class="exercise-edit-fields"><label>Тип<select name="type"><optgroup label="Проверяемые упражнения"><option value="multiple_choice">Multiple choice</option><option value="text_input">Text input</option><option value="reorder_words">Reorder words</option><option value="matching">Matching</option><option value="dropdown">Dropdown</option><option value="drag_drop">Drag & Drop</option></optgroup><optgroup label="Ответ преподавателю"><option value="open_text_teacher_review">Open text — teacher review</option></optgroup><optgroup label="Контент"><option value="video_embed">Video embed</option><option value="embed">Generic embed</option></optgroup></select></label><label class="block-title hidden">Заголовок (необязательно)<input name="title"></label><label>Инструкция / вопрос<textarea name="instruction" rows="2" required></textarea></label><div class="exercise-fields"></div><label class="points-field">Баллы<input name="points" type="number" min="1" value="1"></label><button class="primary-button finish-edit" type="button">Готово</button></div>`;
  el('exercise-list').appendChild(node); renderExerciseFields(node, 'multiple_choice');
  node.querySelector('[name="type"]').addEventListener('change', (e) => renderExerciseFields(node, e.target.value)); node.querySelector('.remove-question').addEventListener('click', () => { node.remove(); renderExerciseEmptyState(); });
  node.querySelectorAll('.move-exercise').forEach((button) => button.addEventListener('click', () => moveExercise(node, button.dataset.direction)));
  node.querySelector('.finish-edit').addEventListener('click', () => { node.classList.remove('editing'); updateExerciseSummary(node); });
  if (exercise) fillExerciseEditor(node, exercise); else { node.dataset.dirty = 'true'; node.classList.add('editing'); } updateExerciseSummary(node);
}

function fillExerciseEditor(node, exercise) { const type = exercise.type || 'multiple_choice'; node.querySelector('[name="type"]').value = type; renderExerciseFields(node, type); node.querySelector('[name="instruction"]').value = exercise.instruction || ''; node.querySelector('[name="title"]').value = exercise.title || ''; node.querySelector('[name="points"]').value = exercise.points || 1;
  if (exercise._recordId) node.dataset.recordId = exercise._recordId;
  if (type === 'multiple_choice') renderMultipleChoiceEditor(node, exercise.content?.options || [], answerList(exercise.correct_answer)[0]);
  if (type === 'text_input') node.querySelector('[name="answers"]').value = answerList(exercise.correct_answer).join(' | ');
  if (type === 'reorder_words') node.querySelector('[name="sentence"]').value = answerList(exercise.correct_answer).join(' ');
  if (type === 'matching') node.querySelector('[name="pairs"]').value = Object.entries(exercise.correct_answer || {}).map(([left, right]) => `${left} = ${right}`).join('\n');
  if (type === 'dropdown') renderDropdownEditor(node, exercise.content?.items || []);
  if (type === 'drag_drop') renderDragDropEditor(node, exercise.content || {});
  if (type === 'open_text_teacher_review') { node.querySelector('[name="open_prompt"]').value = exercise.content?.prompt || ''; node.querySelector('[name="open_placeholder"]').value = exercise.content?.placeholder || ''; node.querySelector('[name="success_criteria"]').value = (exercise.content?.success_criteria || []).join('\n'); }
}
function updateExerciseSummary(node) { const type = node.querySelector('[name="type"]').value, instruction = node.querySelector('[name="instruction"]').value.trim(); node.querySelector('.exercise-summary').innerHTML = `<span class="type-pill">${escapeHtml(type.replace('_', ' '))}</span><strong>${escapeHtml(instruction || 'Новое упражнение')}</strong>`; }

function renderExerciseFields(node, type) {
  const fields = node.querySelector('.exercise-fields');
  const isMedia = ['video_embed', 'embed'].includes(type), hasScore = !isMedia && type !== 'open_text_teacher_review'; node.querySelector('.block-title').classList.toggle('hidden', !isMedia); node.querySelector('.points-field').classList.toggle('hidden', !hasScore); node.querySelector('[name="instruction"]').required = !isMedia;
  if (type === 'multiple_choice') renderMultipleChoiceEditor(node);
  if (type === 'text_input') fields.innerHTML = '<label>Допустимые ответы через |<input name="answers" placeholder="don\'t | do not" required></label>';
  if (type === 'reorder_words') fields.innerHTML = '<label>Правильное предложение<input name="sentence" placeholder="I usually walk to school." required></label>';
  if (type === 'matching') fields.innerHTML = '<label>Пары, каждая с новой строки, формат left = right<textarea name="pairs" rows="5" placeholder="go = went\nsee = saw" required></textarea></label>';
  if (type === 'dropdown') renderDropdownEditor(node);
  if (type === 'drag_drop') renderDragDropEditor(node);
  if (type === 'open_text_teacher_review') fields.innerHTML = '<label>Prompt<textarea name="open_prompt" rows="2" required placeholder="Describe the picture."></textarea></label><label>Placeholder<input name="open_placeholder" placeholder="Type your answer here..."></label><label>Критерии успеха, каждый с новой строки<textarea name="success_criteria" rows="4" required placeholder="Write 2 sentences\nUse is once\nUse isn\'t once"></textarea></label>';
  if (type === 'video_embed') fields.innerHTML = '<label>Ссылка на видео или embed URL<input name="embed_input" type="url" placeholder="https://rutube.ru/video/..." required></label>';
  if (type === 'embed') fields.innerHTML = '<label>Embed URL или iframe-код<textarea name="embed_input" rows="3" placeholder="https://... или <iframe src=&quot;https://...&quot;></iframe>" required></textarea><small class="muted">Будет сохранён только безопасный URL из src. HTML и скрипты не выполняются.</small></label>';
}
function multipleChoiceRow(value = '') { return `<div class="mc-option-row"><label>Вариант<input name="mc_option" value="${escapeAttr(value)}" required></label><button class="danger-button remove-mc-option" type="button">Удалить</button></div>`; }
function syncMultipleChoiceSelect(fields, selectedValue) { const select = fields.querySelector('[name="correct_option"]'), previous = selectedValue ?? select?.value; const options = [...fields.querySelectorAll('[name="mc_option"]')].map((input) => input.value); select.innerHTML = options.map((option, index) => `<option value="${index}">${escapeHtml(option || `Вариант ${index + 1}`)}</option>`).join(''); const preferredIndex = options.indexOf(previous); select.value = String(preferredIndex >= 0 ? preferredIndex : Math.min(Number(previous) || 0, Math.max(0, options.length - 1))); }
function renderMultipleChoiceEditor(node, values = null, correct = '') { const fields = node.querySelector('.exercise-fields'), options = Array.isArray(values) && values.length ? values : ['', '', '', '']; fields.innerHTML = `<div class="mc-options">${options.map(multipleChoiceRow).join('')}</div><button class="secondary-button add-mc-option" type="button">+ Добавить вариант</button><label>Правильный вариант<select name="correct_option"></select></label>`; const bind = (row) => { row.querySelector('[name="mc_option"]').addEventListener('input', () => syncMultipleChoiceSelect(fields)); row.querySelector('.remove-mc-option').addEventListener('click', () => { if (fields.querySelectorAll('.mc-option-row').length > 2) { row.remove(); syncMultipleChoiceSelect(fields); } }); }; fields.querySelectorAll('.mc-option-row').forEach(bind); fields.querySelector('.add-mc-option').addEventListener('click', () => { const wrapper = document.createElement('div'); wrapper.innerHTML = multipleChoiceRow(); const row = wrapper.firstElementChild; fields.querySelector('.mc-options').appendChild(row); bind(row); syncMultipleChoiceSelect(fields); }); syncMultipleChoiceSelect(fields, correct); }
function dropdownItemMarkup(item = {}) { const options = Array.isArray(item.options) ? item.options : []; return `<div class="dropdown-editor-item"><label>Текст до<input name="dropdown_before" value="${escapeAttr(item.text_before || '')}" placeholder="She "></label><label>Варианты через |<input name="dropdown_options" value="${escapeAttr(options.join(' | '))}" placeholder="is | isn't" required></label><label>Правильный ответ<select name="dropdown_correct" required>${options.map((option) => `<option value="${escapeAttr(option)}" ${option === item.correct_answer ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label><label>Текст после<input name="dropdown_after" value="${escapeAttr(item.text_after || '')}" placeholder=" a princess."></label><button class="danger-button remove-dropdown-item" type="button">Удалить строку</button></div>`; }
function dropdownOptions(value) { return String(value || '').split('|').map((option) => option.trim()).filter(Boolean); }
function syncDropdownCorrect(row) { const select = row.querySelector('[name="dropdown_correct"]'), previous = select.value, options = dropdownOptions(row.querySelector('[name="dropdown_options"]').value); select.innerHTML = options.map((option) => `<option value="${escapeAttr(option)}">${escapeHtml(option)}</option>`).join(''); if (options.includes(previous)) select.value = previous; }
function renderDropdownEditor(node, items = [{}]) { const fields = node.querySelector('.exercise-fields'); const list = items.length ? items : [{}]; fields.innerHTML = `<div class="dropdown-editor-list">${list.map(dropdownItemMarkup).join('')}</div><button class="secondary-button add-dropdown-item" type="button">+ Добавить строку</button><small class="muted">Укажите минимум два варианта через символ |.</small>`; const bind = (row) => { row.querySelector('[name="dropdown_options"]').addEventListener('input', () => syncDropdownCorrect(row)); row.querySelector('.remove-dropdown-item').addEventListener('click', () => { if (fields.querySelectorAll('.dropdown-editor-item').length > 1) row.remove(); }); }; fields.querySelectorAll('.dropdown-editor-item').forEach(bind); fields.querySelector('.add-dropdown-item').addEventListener('click', () => { const wrapper = document.createElement('div'); wrapper.innerHTML = dropdownItemMarkup(); const row = wrapper.firstElementChild; fields.querySelector('.dropdown-editor-list').appendChild(row); bind(row); }); }
function dragEditorId(prefix) { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }
function dragZoneEditorMarkup(zone = {}) { return `<div class="drag-zone-editor" data-zone-id="${escapeAttr(zone.id || dragEditorId('z'))}"><label>Название зоны<input name="drag_zone_label" value="${escapeAttr(zone.label || '')}" required placeholder="Picture 1"></label><button class="danger-button remove-drag-zone" type="button">Удалить</button></div>`; }
function dragItemEditorMarkup(item = {}, zones = [], zoneId = '') { return `<div class="drag-item-editor" data-item-id="${escapeAttr(item.id || dragEditorId('d'))}"><label>Перетаскиваемый элемент<input name="drag_item_content" value="${escapeAttr(item.content || '')}" required placeholder="big"></label><label>Правильная зона<select name="drag_correct_zone" required>${zones.map((zone) => `<option value="${escapeAttr(zone.id)}" ${zone.id === zoneId ? 'selected' : ''}>${escapeHtml(zone.label || 'Без названия')}</option>`).join('')}</select></label><button class="danger-button remove-drag-item" type="button">Удалить</button></div>`; }
function currentDragZones(fields) { return [...fields.querySelectorAll('.drag-zone-editor')].map((row) => ({ id: row.dataset.zoneId, label: row.querySelector('[name="drag_zone_label"]').value.trim() })); }
function syncDragZoneSelects(fields) { const zones = currentDragZones(fields); fields.querySelectorAll('[name="drag_correct_zone"]').forEach((select) => { const previous = select.value; select.innerHTML = zones.map((zone) => `<option value="${escapeAttr(zone.id)}">${escapeHtml(zone.label || 'Без названия')}</option>`).join(''); if (zones.some((zone) => zone.id === previous)) select.value = previous; }); }
function renderDragDropEditor(node, data = {}) { const fields = node.querySelector('.exercise-fields'), zones = Array.isArray(data.drop_zones) && data.drop_zones.length ? data.drop_zones : [{ id: dragEditorId('z'), label: '' }], items = Array.isArray(data.draggable_items) && data.draggable_items.length ? data.draggable_items : [{ id: dragEditorId('d'), content: '' }], answers = new Map((data.answers || []).map((answer) => [answer.item_id, answer.zone_id])); fields.innerHTML = `<div class="drag-editor-section"><div class="drag-editor-heading"><strong>Drop zones</strong><button class="secondary-button add-drag-zone" type="button">+ Добавить зону</button></div><div class="drag-zones-editor">${zones.map(dragZoneEditorMarkup).join('')}</div></div><div class="drag-editor-section"><div class="drag-editor-heading"><strong>Draggable items</strong><button class="secondary-button add-drag-item" type="button">+ Добавить элемент</button></div><div class="drag-items-editor">${items.map((item) => dragItemEditorMarkup(item, zones, answers.get(item.id))).join('')}</div></div>`; const bindZone = (row) => { row.querySelector('[name="drag_zone_label"]').addEventListener('input', () => syncDragZoneSelects(fields)); row.querySelector('.remove-drag-zone').addEventListener('click', () => { if (fields.querySelectorAll('.drag-zone-editor').length > 1) { row.remove(); syncDragZoneSelects(fields); } }); }; const bindItem = (row) => row.querySelector('.remove-drag-item').addEventListener('click', () => { if (fields.querySelectorAll('.drag-item-editor').length > 1) row.remove(); }); fields.querySelectorAll('.drag-zone-editor').forEach(bindZone); fields.querySelectorAll('.drag-item-editor').forEach(bindItem); fields.querySelector('.add-drag-zone').addEventListener('click', () => { const wrapper = document.createElement('div'); wrapper.innerHTML = dragZoneEditorMarkup(); const row = wrapper.firstElementChild; fields.querySelector('.drag-zones-editor').appendChild(row); bindZone(row); syncDragZoneSelects(fields); }); fields.querySelector('.add-drag-item').addEventListener('click', () => { const wrapper = document.createElement('div'); wrapper.innerHTML = dragItemEditorMarkup({}, currentDragZones(fields)); const row = wrapper.firstElementChild; fields.querySelector('.drag-items-editor').appendChild(row); bindItem(row); }); }
function moveExercise(node, direction) { const sibling = direction === 'up' ? node.previousElementSibling : node.nextElementSibling; if (sibling) direction === 'up' ? node.parentElement.insertBefore(node, sibling) : node.parentElement.insertBefore(sibling, node); }

function showBuilderPreview() { const nodes = [...document.querySelectorAll('.exercise-editor')], editorExercises = nodes.map((node, order) => exerciseDataForSave(node, order)).filter(Boolean), exercises = editorExercises.length ? editorExercises : (state.previewExercises || []); const form = el('worksheet-form'); el('worksheet-preview-content').innerHTML = worksheetPageMarkup({ id: state.editingWorksheet?.id || '', title: worksheetTitleValue(form) || 'Worksheet', instructions: form.elements.work_goal.value, intro_text: form.elements.intro_text.value, estimated_time: state.editingWorksheet?.estimated_time || form.elements.estimated_time.value }, exercises, true); bindWorksheetInteractions(el('worksheet-preview-content')); el('worksheet-preview-dialog').showModal(); }

function worksheetDataFromForm(status = 'draft') { const form = el('worksheet-form'), due = form.elements.due_date.value, workGoal = form.elements.work_goal.value.trim(); return { student: form.elements.student.value, title: worksheetTitleValue(form), instructions: workGoal, focus: workGoal, intro_text: form.elements.intro_text.value.trim(), estimated_time: form.elements.estimated_time.value.trim(), status, due_date: due ? new Date(due).toISOString() : '', created_by: pb.authStore.record.id }; }
async function syncWorksheetSources(worksheetId) {
  const form = el('worksheet-form'); rememberSourceMetadata(); const selectedMaterials = [...form.querySelectorAll('[name="library_sources"]:checked')].map((input) => input.value), existingLibrarySources = (state.editingSources || []).filter((source) => source.source_type === 'library');
  if ([...form.elements.source_files.files].some((file) => file.size > SOURCE_UPLOAD_LIMIT)) throw new Error('Максимальный размер одного source-файла — 100 МБ');
  for (const source of existingLibrarySources) { if (!selectedMaterials.includes(source.material)) await pb.collection('worksheet_sources').delete(source.id); else await pb.collection('worksheet_sources').update(source.id, { metadata: state.sourceMetadata[`library-${source.material}`] || {} }); }
  for (const source of (state.editingSources || []).filter((item) => item.source_type === 'upload')) await pb.collection('worksheet_sources').update(source.id, { metadata: state.sourceMetadata[`saved-${source.id}`] || {} });
  let sourceOrder = (state.editingSources || []).filter((source) => source.source_type === 'upload').length;
  for (const material of selectedMaterials) if (!existingLibrarySources.some((source) => source.material === material)) await pb.collection('worksheet_sources').create({ worksheet: worksheetId, material, source_type: 'library', metadata: state.sourceMetadata[`library-${material}`] || {}, order: sourceOrder++ });
  for (const [index, file] of [...form.elements.source_files.files].entries()) { const data = new FormData(); data.set('worksheet', worksheetId); data.set('uploaded_file', file); data.set('source_type', 'upload'); data.set('metadata', JSON.stringify(state.sourceMetadata[`upload-${index}`] || {})); data.set('order', sourceOrder++); await pb.collection('worksheet_sources').create(data); }
  state.editingSources = await pb.collection('worksheet_sources').getFullList({ filter: `worksheet="${worksheetId}"`, sort: 'order', requestKey: null }); form.elements.source_files.value = ''; state.sourceMetadata = Object.fromEntries(state.editingSources.map((source) => [source.source_type === 'library' ? `library-${source.material}` : `saved-${source.id}`, source.metadata || {}])); updateSelectedSources();
}
async function ensureAgentWorksheetDraft() {
  const form = el('worksheet-form'), workGoal = form.elements.work_goal.value.trim(); if (!worksheetTitleValue(form)) throw new Error('Заполните название worksheet.'); if (!workGoal) throw new Error('Заполните поле «Что отработать».');
  const worksheet = state.editingWorksheet ? await pb.collection('worksheets').update(state.editingWorksheet.id, worksheetDataFromForm('draft')) : await pb.collection('worksheets').create(worksheetDataFromForm('draft'));
  state.editingWorksheet = worksheet; if (!state.builderDrafts.some((draft) => draft.id === worksheet.id)) state.builderDrafts.unshift(worksheet); await syncWorksheetSources(worksheet.id);
}

function exerciseDataForSave(node, order) {
  const recordId = node.dataset.recordId;
  if (recordId && node.dataset.dirty !== 'true') {
    const original = (state.previewExercises || []).find((exercise) => exercise.id === recordId);
    if (original) return { id: original.id, type: original.type, title: original.title || '', instruction: original.instruction || '', embed_url: original.embed_url || '', content: exerciseContent(original), correct_answer: original.correct_answer ?? null, order, points: Number(original.points || 0) };
  }
  const edited = readWorksheetExercise(node, order);
  return edited ? { id: recordId || '', ...edited } : null;
}
function exerciseValidationMessage(nodes) { for (const [index, node] of nodes.entries()) { if (node.dataset.dirty !== 'true') continue; const invalid = [...node.querySelectorAll('[required]')].find((field) => !field.disabled && (!String(field.value || '').trim() || !field.checkValidity())); if (invalid) { const label = invalid.closest('label')?.childNodes[0]?.textContent?.trim() || invalid.name || 'обязательное поле'; return `Заполните поле «${label}» в блоке ${index + 1}.`; } } return 'Проверьте заполнение упражнений.'; }
function refreshBuilderDraftList() { const list = document.querySelector('.draft-list'); if (!list) return; list.innerHTML = state.builderDrafts.map(draftListMarkup).join('') || '<p class="muted drafts-empty">Черновиков пока нет.</p>'; const count = el('draft-count'); if (count) count.textContent = state.builderDrafts.length; list.querySelectorAll('.open-draft').forEach((button) => button.addEventListener('click', () => openWorksheetDraft(button.dataset.draftId))); list.querySelectorAll('.delete-draft').forEach((button) => button.addEventListener('click', () => deleteWorksheetDraft(button.dataset.draftId))); }

async function saveWorksheet(event) {
  event.preventDefault(); const form = event.currentTarget; const status = event.submitter?.dataset.status || 'draft'; const nodes = [...form.querySelectorAll('.exercise-editor')];
  const showError = (message) => { el('worksheet-error').textContent = message; toast(message); };
  el('worksheet-error').textContent = '';
  if (!worksheetTitleValue(form)) { showError('Заполните название worksheet.'); form.querySelector('#worksheet-title')?.focus(); return; }
  if (!form.elements.work_goal.value.trim()) { showError('Заполните поле «Что отработать».'); form.elements.work_goal.focus(); return; }
  if (status === 'published' && !form.elements.student.value) { showError('Для публикации выберите ученика.'); form.elements.student.focus(); return; }
  if (status === 'published' && !nodes.length) { showError('Для публикации добавьте хотя бы одно упражнение.'); return; }
  const exercises = nodes.map((node, order) => exerciseDataForSave(node, order)); if (exercises.some((exercise) => !exercise)) { showError(exerciseValidationMessage(nodes)); return; }
  setLoading(true);
  try {
    const worksheetData = worksheetDataFromForm(status);
    const worksheet = state.editingWorksheet ? await pb.collection('worksheets').update(state.editingWorksheet.id, worksheetData) : await pb.collection('worksheets').create(worksheetData);
    const retainedExerciseIds = [];
    const savedExercises = [];
    for (let index = 0; index < exercises.length; index++) { const { id: recordId, ...exerciseData } = exercises[index]; let saved; if (recordId) { saved = await pb.collection('worksheet_exercises').update(recordId, { ...exerciseData, worksheet: worksheet.id }); } else { saved = await pb.collection('worksheet_exercises').create({ ...exerciseData, worksheet: worksheet.id }); nodes[index].dataset.recordId = saved.id; } nodes[index].dataset.dirty = 'false'; retainedExerciseIds.push(saved.id); savedExercises.push(saved); }
    for (const oldId of state.editingExerciseIds || []) if (!retainedExerciseIds.includes(oldId)) await pb.collection('worksheet_exercises').delete(oldId);
    await syncWorksheetSources(worksheet.id);
    let homework = state.editingHomework;
    if (form.elements.student.value) { const homeworkData = { student: form.elements.student.value, title: worksheetTitleValue(form), instructions: form.elements.work_goal.value.trim(), due_date: worksheetData.due_date, status, created_by: pb.authStore.record.id, worksheet: worksheet.id }; homework = homework ? await pb.collection('homework').update(homework.id, homeworkData) : await pb.collection('homework').create(homeworkData); }
    state.editingWorksheet = worksheet; state.editingHomework = homework || null; state.editingExerciseIds = retainedExerciseIds; state.previewExercises = savedExercises;
    if (status === 'published') { state.builderDrafts = state.builderDrafts.filter((draft) => draft.id !== worksheet.id); if (homework) { const homeworkIndex = state.teacherData.homework.findIndex((item) => item.id === homework.id); if (homeworkIndex >= 0) state.teacherData.homework[homeworkIndex] = homework; else state.teacherData.homework.unshift(homework); } setHeader('Редактировать worksheet', 'Worksheet опубликован.', 'Published'); toast('Worksheet опубликован'); const result = el('publish-result'); result.innerHTML = `<strong>Worksheet опубликован</strong><button id="open-published-worksheet" class="secondary-button" type="button">Открыть опубликованный worksheet</button>`; el('open-published-worksheet').addEventListener('click', () => openBuilderPublishedPreview(worksheet.id)); }
    else { const existingIndex = state.builderDrafts.findIndex((draft) => draft.id === worksheet.id); if (existingIndex >= 0) state.builderDrafts[existingIndex] = worksheet; else state.builderDrafts.unshift(worksheet); setHeader('Редактировать worksheet', 'Черновик сохранён. Можно продолжить редактирование.', 'Draft'); toast('Черновик сохранён'); }
    refreshBuilderDraftList(); document.querySelectorAll('.draft-item').forEach((item) => item.classList.toggle('active', status === 'draft' && item.dataset.draftId === worksheet.id));
  } catch (error) { const message = error?.response?.message || error?.message || String(error); showError(message); console.error(error); } finally { setLoading(false); }
}

function readWorksheetExercise(node, order) {
  const type = node.querySelector('[name="type"]').value, instruction = node.querySelector('[name="instruction"]').value.trim(), points = Number(node.querySelector('[name="points"]').value || 1);
  if (['video_embed', 'embed'].includes(type)) { const embedUrl = normalizeEmbedInput(node.querySelector('[name="embed_input"]').value, type); if (!embedUrl) return null; return { type, title: node.querySelector('[name="title"]').value.trim(), instruction, embed_url: embedUrl, content: {}, correct_answer: null, order, points: 0 }; }
  if (!instruction) return null;
  if (type === 'multiple_choice') { const options = [...node.querySelectorAll('[name="mc_option"]')].map((input) => input.value.trim()); if (options.length < 2 || options.some((x) => !x)) return null; return { type, instruction, content: { options }, correct_answer: [options[Number(node.querySelector('[name="correct_option"]').value)]], order, points }; }
  if (type === 'text_input') { const answers = node.querySelector('[name="answers"]').value.split('|').map((x) => x.trim()).filter(Boolean); return answers.length ? { type, instruction, content: {}, correct_answer: answers, order, points } : null; }
  if (type === 'reorder_words') { const sentence = node.querySelector('[name="sentence"]').value.trim(); const words = sentence.match(/[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}'’]/gu) || []; return words.length ? { type, instruction, content: { words: shuffle(words) }, correct_answer: words, order, points } : null; }
  if (type === 'dropdown') { const items = [...node.querySelectorAll('.dropdown-editor-item')].map((row) => { const options = dropdownOptions(row.querySelector('[name="dropdown_options"]').value), correctAnswer = row.querySelector('[name="dropdown_correct"]').value; return { text_before: row.querySelector('[name="dropdown_before"]').value, options, correct_answer: correctAnswer, text_after: row.querySelector('[name="dropdown_after"]').value }; }); if (!items.length || items.some((item) => item.options.length < 2 || new Set(item.options).size !== item.options.length || !item.correct_answer || !item.options.includes(item.correct_answer))) return null; return { type, instruction, content: { items }, correct_answer: items.map((item) => item.correct_answer), order, points }; }
  if (type === 'drag_drop') { const dropZones = currentDragZones(node).map((zone) => ({ id: zone.id, label: zone.label })), draggableItems = [...node.querySelectorAll('.drag-item-editor')].map((row) => ({ id: row.dataset.itemId, content: row.querySelector('[name="drag_item_content"]').value.trim() })), answers = [...node.querySelectorAll('.drag-item-editor')].map((row) => ({ item_id: row.dataset.itemId, zone_id: row.querySelector('[name="drag_correct_zone"]').value })); if (!dropZones.length || !draggableItems.length || dropZones.some((zone) => !zone.label) || draggableItems.some((item) => !item.content) || answers.some((answer) => !dropZones.some((zone) => zone.id === answer.zone_id))) return null; return { type, instruction, content: { draggable_items: draggableItems, drop_zones: dropZones, answers }, correct_answer: answers, order, points }; }
  if (type === 'open_text_teacher_review') { const prompt = node.querySelector('[name="open_prompt"]').value.trim(), placeholder = node.querySelector('[name="open_placeholder"]').value.trim(), successCriteria = node.querySelector('[name="success_criteria"]').value.split('\n').map((item) => item.trim()).filter(Boolean); return prompt && successCriteria.length ? { type, instruction, content: { prompt, placeholder, success_criteria: successCriteria }, correct_answer: null, order, points: 0 } : null; }
  const pairs = node.querySelector('[name="pairs"]').value.split('\n').map((line) => line.split('=').map((x) => x.trim())).filter((pair) => pair.length === 2 && pair[0] && pair[1]); return pairs.length ? { type, instruction, content: { left: pairs.map((p) => p[0]), right: shuffle(pairs.map((p) => p[1])) }, correct_answer: Object.fromEntries(pairs), order, points } : null;
}

function normalizeEmbedInput(value, type) {
  const raw = String(value || '').trim(); let candidate = raw;
  if (/<iframe\b/i.test(raw)) { const match = raw.match(/\bsrc\s*=\s*(["'])(.*?)\1/i); candidate = match?.[2] || ''; }
  try {
    const url = new URL(candidate); if (!['https:', 'http:'].includes(url.protocol)) return '';
    if (type === 'video_embed' && /(^|\.)rutube\.ru$/i.test(url.hostname)) {
      const videoMatch = url.pathname.match(/^\/video\/(?:private\/)?([a-zA-Z0-9]+)\/?/); if (videoMatch) return `https://rutube.ru/play/embed/${videoMatch[1]}`;
      const embedMatch = url.pathname.match(/^\/play\/embed\/([a-zA-Z0-9]+)/); if (embedMatch) return `https://rutube.ru/play/embed/${embedMatch[1]}`;
    }
    return url.href;
  } catch (_) { return ''; }
}

async function renderWorksheetPlayer() {
  const worksheet = state.homework.expand?.worksheet || await pb.collection('worksheets').getOne(state.homework.worksheet, { requestKey: null });
  state.worksheet = worksheet; state.exercises = await pb.collection('worksheet_exercises').getFullList({ filter: `worksheet="${worksheet.id}"`, sort: 'order', requestKey: null });
  const assessable = state.exercises.filter(isAssessableExercise), reviewable = state.exercises.filter((exercise) => exercise.type === 'open_text_teacher_review'); setHeader(worksheet.title, worksheet.instructions || 'Выполните все упражнения.', `0 из ${assessable.length}`);
  const existingResult = state.result?.homework === state.homework.id ? state.result : null;
  const savedStatus = existingResult?.status === 'needs_review' ? 'Ответ отправлен преподавателю' : existingResult ? `Сохранённый результат: ${existingResult.score}/${existingResult.max_score} · ${existingResult.percentage}%` : '';
  el('content').innerHTML = worksheetPageMarkup(worksheet, state.exercises, false, savedStatus);
  bindWorksheetInteractions(el('worksheet-player')); el('worksheet-player').addEventListener('submit', checkWorksheet);
}

function worksheetPageMarkup(worksheet, exercises, preview = false, savedStatus = '') { const assessable = exercises.filter(isAssessableExercise), reviewable = exercises.filter((exercise) => exercise.type === 'open_text_teacher_review'), characterCards = characterCardsFrom(worksheet, exercises), introText = String(worksheet.intro_text || '').trim(); return `<form ${preview ? '' : 'id="worksheet-player"'} class="worksheet-page student-worksheet"><header class="worksheet-intro">${preview && worksheet.id ? `<p class="worksheet-label">Worksheet ID: ${escapeHtml(worksheet.id)}</p>` : ''}<p class="worksheet-label">Interactive worksheet</p><h2>${escapeHtml(worksheet.title || 'Worksheet')}</h2>${worksheet.instructions ? `<p class="worksheet-goal">${escapeHtml(worksheet.instructions)}</p>` : ''}<div class="worksheet-meta">${worksheet.estimated_time ? `<span>Время: ${escapeHtml(worksheet.estimated_time)}</span>` : ''}<span id="worksheet-progress">Выполнено 0 из ${assessable.length}</span></div></header>${introText ? `<section class="worksheet-intro-text">${escapeHtml(introText).replace(/\n/g, '<br>')}</section>` : ''}${characterCardsMarkup(characterCards)}<main class="worksheet-tasks">${exercises.map(worksheetExerciseMarkup).join('')}</main><footer class="worksheet-submit"><button class="primary-button" type="${preview ? 'button' : 'submit'}" ${assessable.length || reviewable.length ? '' : 'disabled'}>Finish worksheet</button><strong id="worksheet-score">${escapeHtml(savedStatus)}</strong></footer></form>`; }

function exerciseContent(exercise) { const value = exercise?.content; if (value && typeof value === 'object') return value; if (typeof value === 'string') { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch (_) { return {}; } } return {}; }
function exerciseItems(exercise) { const content = exerciseContent(exercise); if (Array.isArray(content.items) && content.items.length) return content.items; return [content]; }
function characterCardsFrom(worksheet, exercises) { const candidates = [worksheet.character_cards, worksheet.characters, worksheet.student_content?.character_cards, worksheet.intro?.character_cards]; exercises.forEach((exercise) => { const content = exercise.content || {}; candidates.push(content.character_cards, content.characters, content.cards, content.intro?.character_cards, content.intro?.characters, content.student_content?.character_cards); }); const value = candidates.find((candidate) => Array.isArray(candidate) && candidate.length); return value || []; }
function characterCardsMarkup(cards) { if (!cards.length) return ''; return `<section class="character-cards-section"><p class="worksheet-label">Character cards</p><div class="character-cards">${cards.map((card) => { const name = card.name || card.title || card.character || '', rawLines = card.lines || card.sentences || card.description || card.text || [], lines = Array.isArray(rawLines) ? rawLines : String(rawLines).split('\n').filter(Boolean); return `<article class="character-card"><h3>${escapeHtml(name)}</h3>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</article>`; }).join('')}</div></section>`; }
function studentTextLines(value) { if (!value) return []; if (Array.isArray(value)) return value.flatMap(studentTextLines); if (typeof value === 'string') return value.split('\n').map((line) => line.trim()).filter(Boolean); if (typeof value !== 'object') return [String(value)]; const heading = value.label || value.title || value.name || value.heading || ''; const body = value.text || value.description || value.content || value.lines || value.sentences || value.facts || value.cards || ''; let lines = studentTextLines(body); if (!heading && !lines.length) lines = Object.entries(value).flatMap(([key, item]) => [key, ...studentTextLines(item)]); return heading ? [heading, ...lines] : lines; }
function studentInfoBlocksMarkup(values, className = 'answer-support') { const blocks = values.filter(Boolean).map((value) => studentTextLines(value)).filter((lines) => lines.length); if (!blocks.length) return ''; return `<div class="${className}">${blocks.map((lines) => `<article>${lines.map((line, index) => index === 0 && lines.length > 1 ? `<strong>${escapeHtml(line)}</strong>` : `<p>${escapeHtml(line)}</p>`).join('')}</article>`).join('')}</div>`; }
function multipleChoiceContextMarkup(content) { return studentInfoBlocksMarkup([content.context, content.description, content.descriptions, content.description_blocks, content.support, content.fact_cards], 'worksheet-context'); }
function multipleChoiceMarkup(exercise) { const content = exerciseContent(exercise); return `${multipleChoiceContextMarkup(content)}${exerciseItems(exercise).map((item, index) => { const options = Array.isArray(item.options) ? item.options : (content.options || []), question = item.question || item.text || (index ? '' : content.question || ''); return `<fieldset class="worksheet-item mc-item" data-item-index="${index}"><legend><span>${index + 1}.</span> ${escapeHtml(question)}</legend><div class="choice-grid">${options.map((option) => `<label class="option"><input type="radio" name="ws-${exercise.id}-${index}" value="${escapeAttr(option)}"><span>${escapeHtml(option)}</span></label>`).join('')}</div></fieldset>`; }).join('')}`; }
function inlineDropdownGaps(itemText, item) { const answers = Array.isArray(item.correct_answers) ? item.correct_answers : (Array.isArray(item.correct_answer) ? item.correct_answer : [item.correct_answer]); return [...itemText.matchAll(/\[([^\[\]]+\/[^\[\]]+)\]/g)].map((match, index) => ({ key: `inline${index + 1}`, token: match[0], options: match[1].split('/').map((option) => option.trim()).filter(Boolean), correct_answer: answers[index] })); }
function dropdownGapData(item) { const gaps = []; Object.keys(item).filter((key) => /^gap\d+_options$/.test(key)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).forEach((key) => { const number = key.match(/\d+/)[0]; gaps.push({ key: `gap${number}`, options: item[key] || [], correct_answer: item[`gap${number}_correct`] }); }); const itemText = String(item.text || item.sentence || item.question || ''); if (!gaps.length) gaps.push(...inlineDropdownGaps(itemText, item)); if (!gaps.length && Array.isArray(item.options)) gaps.push({ key: 'gap1', options: item.options, correct_answer: item.correct_answer }); return gaps; }
function dropdownItemMarkupStudent(exercise, item, itemIndex) { const itemText = String(item.text || item.sentence || item.question || '').trim(); if (!itemText && (item.text_before !== undefined || item.text_after !== undefined)) return `<div class="dropdown-sentence" data-item-index="${itemIndex}"><span>${escapeHtml(item.text_before || '')}</span>${dropdownSelectMarkup(exercise, itemIndex, 0, item.options || [])}<span>${escapeHtml(item.text_after || '')}</span></div>`; const gaps = dropdownGapData(item); let text = escapeHtml(itemText); gaps.forEach((gap, gapIndex) => { const select = dropdownSelectMarkup(exercise, itemIndex, gapIndex, gap.options); const escapedToken = gap.token ? escapeHtml(gap.token) : ''; const patterns = [escapedToken, new RegExp(`\\[${gap.key}\\]`, 'i'), new RegExp(`\\{${gap.key}\\}`, 'i'), /_{2,}/].filter(Boolean); const pattern = patterns.find((candidate) => typeof candidate === 'string' ? text.includes(candidate) : candidate.test(text)); text = pattern ? text.replace(pattern, select) : `${text} ${select}`; }); return `<div class="dropdown-sentence" data-item-index="${itemIndex}">${text}</div>`; }
function dropdownSelectMarkup(exercise, itemIndex, gapIndex, options) { return `<select name="ws-${exercise.id}-${itemIndex}-${gapIndex}" aria-label="Выберите вариант"><option value="">Выберите…</option>${options.map((option) => `<option value="${escapeAttr(option)}">${escapeHtml(option)}</option>`).join('')}</select>`; }
function matchingData(exercise) { const content = exercise.content || {}; if (Array.isArray(content.pairs)) return content.pairs.filter((pair) => pair?.left !== undefined && pair?.right !== undefined); if (Array.isArray(content.left)) return content.left.map((left) => ({ left, right: exercise.correct_answer?.[left] })).filter((pair) => pair.right !== undefined); return Object.entries(exercise.correct_answer || {}).map(([left, right]) => ({ left, right })); }
function reorderItems(exercise) { const content = exerciseContent(exercise); return exerciseItems(exercise).map((item) => { const nested = item?.content && typeof item.content === 'object' ? item.content : {}; const answer = item.correct_answer ?? nested.correct_answer ?? exercise.correct_answer, rawWords = item.words ?? nested.words ?? content.words ?? [], words = Array.isArray(rawWords) ? rawWords.map((word) => typeof word === 'object' ? (word.text || word.word || word.content || '') : String(word)).filter(Boolean) : String(rawWords).split(/\s+/).filter(Boolean), correct = Array.isArray(answer) ? answer.map(String) : String(answer || '').match(/[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}'’]/gu) || []; return { prompt: item.question || item.text || item.prompt || '', words, correct }; }); }

function worksheetExerciseMarkup(exercise, index) {
  let answer = ''; const content = exerciseContent(exercise);
  if (['video_embed', 'embed'].includes(exercise.type)) return embedBlockMarkup(exercise);
  if (exercise.type === 'multiple_choice') answer = multipleChoiceMarkup(exercise);
  if (exercise.type === 'text_input') answer = `<input class="text-answer" name="ws-${exercise.id}" autocomplete="off">`;
  if (exercise.type === 'reorder_words') answer = reorderItems(exercise).map((item, itemIndex) => `<div class="reorder-item" data-item-index="${itemIndex}">${item.prompt ? `<p class="item-prompt">${escapeHtml(item.prompt)}</p>` : ''}<div class="word-bank">${item.words.map((word, wordIndex) => `<button class="word-token" data-index="${wordIndex}" type="button">${escapeHtml(word)}</button>`).join('')}</div><div class="word-answer" aria-label="Составленное предложение"></div></div>`).join('');
  if (exercise.type === 'matching') { const pairs = matchingData(exercise), rights = shuffle(pairs.map((pair) => pair.right)); answer = `<div class="matching-tap"><div class="match-column">${pairs.map((pair) => `<button class="match-item match-left" data-value="${escapeAttr(pair.left)}" type="button">${escapeHtml(pair.left)}</button>`).join('')}</div><div class="match-column">${rights.map((right) => `<button class="match-item match-right" data-value="${escapeAttr(right)}" type="button">${escapeHtml(right)}</button>`).join('')}</div></div><p class="interaction-hint">Нажмите элемент слева, затем подходящий вариант справа.</p>`; }
  if (exercise.type === 'dropdown') answer = `<div class="dropdown-exercise">${exerciseItems(exercise).map((item, itemIndex) => dropdownItemMarkupStudent(exercise, item, itemIndex)).join('')}</div>`;
  if (exercise.type === 'drag_drop') answer = `<div class="drag-drop-exercise"><div class="drag-item-bank drop-target" data-bank="true"><span class="drag-area-label">Элементы</span>${(content.draggable_items || []).map((item) => `<button class="drag-item" type="button" draggable="true" data-item-id="${escapeAttr(item.id)}">${escapeHtml(item.content)}</button>`).join('')}</div><div class="drop-zones">${(content.drop_zones || []).map((zone) => `<div class="drop-zone drop-target" data-zone-id="${escapeAttr(zone.id)}"><strong>${escapeHtml(zone.label)}</strong><div class="drop-zone-items"></div></div>`).join('')}</div><p class="drag-hint">Перетащите элемент или нажмите на него, затем на нужную зону.</p></div>`;
  if (exercise.type === 'open_text_teacher_review') { const saved = savedOpenTextAnswer(exercise.id), factCards = content.fact_cards || content.cards || content.facts, sentenceHelp = content.sentence_help || content.support || content.scaffolding, criteriaRaw = content.success_criteria || content.success_criterion || [], criteria = Array.isArray(criteriaRaw) ? criteriaRaw : [criteriaRaw]; answer = `<div class="open-text-review">${content.prompt ? `<h4>${escapeHtml(content.prompt)}</h4>` : ''}${studentInfoBlocksMarkup([factCards], 'worksheet-context fact-cards')}${studentInfoBlocksMarkup([sentenceHelp], 'answer-support sentence-help')}<textarea name="open-${exercise.id}" rows="7" placeholder="${escapeAttr(content.placeholder || 'Type your answer here…')}">${escapeHtml(saved)}</textarea>${criteria.filter(Boolean).length ? `<div class="success-box"><strong>Success criterion</strong><ul>${criteria.filter(Boolean).map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join('')}</ul></div>` : ''}<p class="teacher-review-note">Teacher will review.</p></div>`; }
  return `<section class="worksheet-exercise task-section" data-exercise="${exercise.id}"><div class="task-heading"><div><span class="task-label">Task ${index + 1}</span><h3>${escapeHtml(exercise.instruction)}</h3></div></div><div class="worksheet-answer">${answer}</div><p class="feedback" aria-live="polite"></p></section>`;
}

function bindWorksheetInteractions(root) { root.querySelectorAll('.word-token').forEach((button) => button.addEventListener('click', toggleWordToken)); root.querySelectorAll('.match-item').forEach((button) => button.addEventListener('click', selectMatchItem)); root.querySelectorAll('.worksheet-answer input, .worksheet-answer select, .worksheet-answer textarea').forEach((input) => input.addEventListener('change', updateWorksheetProgress)); bindDragDrop(root); }

function savedOpenTextAnswer(exerciseId) { const answers = Array.isArray(state.result?.open_answers) ? state.result.open_answers : []; return answers.find((item) => item.exercise_id === exerciseId)?.answer || ''; }

function embedBlockMarkup(block) { const label = block.type === 'video_embed' ? 'Видео' : 'Интерактивный материал'; const fallback = block.type === 'video_embed' ? 'Открыть видео' : 'Открыть материал'; return `<section class="worksheet-media-block"><div class="media-block-heading"><span>${label}</span>${block.title ? `<h3>${escapeHtml(block.title)}</h3>` : ''}${block.instruction ? `<p>${escapeHtml(block.instruction)}</p>` : ''}</div><div class="embed-frame-wrap"><iframe src="${escapeAttr(block.embed_url)}" title="${escapeAttr(block.title || label)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture" allowfullscreen></iframe><a class="secondary-button embed-fallback" href="${escapeAttr(block.embed_url)}" target="_blank" rel="noopener noreferrer">${fallback}</a></div></section>`; }

function isAssessableExercise(exercise) { return ['multiple_choice', 'text_input', 'reorder_words', 'matching', 'dropdown', 'drag_drop'].includes(exercise.type) && Number(exercise.points || 0) > 0; }

function toggleWordToken(event) { const button = event.currentTarget, item = button.closest('.reorder-item'), answer = item.querySelector('.word-answer'); button.classList.toggle('selected'); if (button.classList.contains('selected')) answer.appendChild(button); else item.querySelector('.word-bank').appendChild(button); updateWorksheetProgress(); }
function selectMatchItem(event) { const button = event.currentTarget, section = button.closest('.worksheet-exercise'); if (button.classList.contains('paired')) { const pairId = button.dataset.pairId; section.querySelectorAll(`[data-pair-id="${pairId}"]`).forEach((item) => { item.classList.remove('paired'); delete item.dataset.pairId; delete item.dataset.pairLabel; }); updateWorksheetProgress(); return; } const side = button.classList.contains('match-left') ? 'left' : 'right'; section.querySelectorAll(`.match-${side}.active`).forEach((item) => item.classList.remove('active')); button.classList.add('active'); const left = section.querySelector('.match-left.active'), right = section.querySelector('.match-right.active'); if (left && right) { const pairId = `${Date.now()}-${Math.random()}`, usedLabels = new Set([...section.querySelectorAll('.match-item.paired')].map((item) => Number(item.dataset.pairLabel))), pairLabel = Array.from({ length: section.querySelectorAll('.match-left').length }, (_, index) => index + 1).find((label) => !usedLabels.has(label)) || 1; [left, right].forEach((item) => { item.classList.remove('active'); item.classList.add('paired'); item.dataset.pairId = pairId; item.dataset.pairLabel = pairLabel; }); } updateWorksheetProgress(); }
function moveDragItem(section, itemId, target) { const item = [...section.querySelectorAll('.drag-item')].find((candidate) => candidate.dataset.itemId === itemId); if (!item || !target) return; const destination = target.classList.contains('drop-zone') ? target.querySelector('.drop-zone-items') : target; destination.appendChild(item); section.querySelectorAll('.drag-item.active').forEach((candidate) => candidate.classList.remove('active')); if (section.closest('#worksheet-player')) updateWorksheetProgress(); }
function bindDragDrop(root) { root.querySelectorAll('.drag-drop-exercise').forEach((exercise) => { const section = exercise.closest('.worksheet-exercise'); exercise.querySelectorAll('.drag-item').forEach((item) => { item.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', item.dataset.itemId); event.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); }); item.addEventListener('dragend', () => item.classList.remove('dragging')); item.addEventListener('click', () => { const active = item.classList.contains('active'); section.querySelectorAll('.drag-item.active').forEach((candidate) => candidate.classList.remove('active')); if (!active) item.classList.add('active'); }); }); exercise.querySelectorAll('.drop-target').forEach((target) => { target.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.classList.add('drag-over'); }); target.addEventListener('dragleave', () => target.classList.remove('drag-over')); target.addEventListener('drop', (event) => { event.preventDefault(); target.classList.remove('drag-over'); moveDragItem(section, event.dataTransfer.getData('text/plain'), target); }); target.addEventListener('click', (event) => { if (event.target.closest('.drag-item')) return; const active = section.querySelector('.drag-item.active'); if (active) moveDragItem(section, active.dataset.itemId, target); }); }); }); }
function updateWorksheetProgress() { if (!el('worksheet-player')) return; const assessable = state.exercises.filter(isAssessableExercise); const completed = assessable.filter((exercise) => { const section = document.querySelector(`[data-exercise="${exercise.id}"]`); if (!section) return false; if (exercise.type === 'multiple_choice') { const items = exerciseItems(exercise); return items.every((_, index) => section.querySelector(`input[name="ws-${exercise.id}-${index}"]:checked`)); } if (exercise.type === 'text_input') return !!section.querySelector('input').value.trim(); if (exercise.type === 'reorder_words') { const items = section.querySelectorAll('.reorder-item'); return items.length > 0 && [...items].every((item) => item.querySelectorAll('.word-answer .word-token').length > 0); } if (exercise.type === 'dropdown') { const selects = [...section.querySelectorAll('.dropdown-sentence select')]; return selects.length > 0 && selects.every((select) => select.value !== ''); } if (exercise.type === 'drag_drop') { const items = section.querySelectorAll('.drag-item').length; return items > 0 && section.querySelectorAll('.drop-zone .drag-item').length === items; } return section.querySelectorAll('.match-left.paired').length === section.querySelectorAll('.match-left').length; }).length; el('page-kicker').textContent = `${completed} из ${assessable.length}`; const indicator = el('worksheet-progress'); if (indicator) indicator.textContent = `Выполнено ${completed} из ${assessable.length}`; }

async function checkWorksheet(event) {
  event.preventDefault(); let score = 0, maxScore = 0; const reviewExercises = state.exercises.filter((exercise) => exercise.type === 'open_text_teacher_review'), openAnswers = reviewExercises.map((exercise) => ({ exercise_id: exercise.id, prompt: exercise.content?.prompt || '', answer: document.querySelector(`[data-exercise="${exercise.id}"] textarea`).value.trim() }));
  if (openAnswers.some((item) => !item.answer)) { toast('Заполните открытый ответ перед отправкой'); document.querySelector(`[data-exercise="${openAnswers.find((item) => !item.answer).exercise_id}"] textarea`).focus(); return; }
  state.exercises.filter(isAssessableExercise).forEach((exercise) => { const section = document.querySelector(`[data-exercise="${exercise.id}"]`); const points = Number(exercise.points); maxScore += points; let correct = false;
    if (exercise.type === 'multiple_choice') { const items = exerciseItems(exercise), fallbackAnswers = answerList(exercise.correct_answer); correct = items.every((item, index) => { const expected = item.correct_answer ?? fallbackAnswers[index] ?? fallbackAnswers[0], selected = section.querySelector(`input[name="ws-${exercise.id}-${index}"]:checked`); const itemCorrect = normalize(selected?.value || '') === normalize(expected); section.querySelectorAll(`input[name="ws-${exercise.id}-${index}"]`).forEach((input) => input.closest('.option').classList.toggle('wrong-option', input.checked && !itemCorrect)); return itemCorrect; }); }
    if (exercise.type === 'text_input') correct = (exercise.correct_answer || []).some((a) => normalize(a) === normalize(section.querySelector('input').value));
    if (exercise.type === 'reorder_words') correct = reorderItems(exercise).every((item, index) => JSON.stringify([...section.querySelectorAll(`.reorder-item[data-item-index="${index}"] .word-answer .word-token`)].map((button) => button.textContent)) === JSON.stringify(item.correct));
    if (exercise.type === 'matching') correct = matchingData(exercise).every(({ left, right }) => { const leftItem = [...section.querySelectorAll('.match-left')].find((item) => item.dataset.value === String(left)); const pairedRight = [...section.querySelectorAll('.match-right')].find((item) => item.dataset.pairId && item.dataset.pairId === leftItem?.dataset.pairId); return pairedRight?.dataset.value === String(right); });
    if (exercise.type === 'dropdown') { const items = exerciseItems(exercise), expected = items.flatMap((item) => dropdownGapData(item).map((gap) => gap.correct_answer)), selects = [...section.querySelectorAll('.dropdown-sentence select')]; correct = expected.length > 0 && selects.length === expected.length && expected.every((answer, index) => selects[index].value === String(answer)); selects.forEach((select, index) => { select.classList.toggle('correct-answer', select.value === String(expected[index])); select.classList.toggle('wrong-answer', select.value !== String(expected[index])); }); }
    if (exercise.type === 'drag_drop') { const answers = exercise.content?.answers || []; correct = answers.length > 0 && answers.every((answer) => { const item = [...section.querySelectorAll('.drag-item')].find((candidate) => candidate.dataset.itemId === answer.item_id), zone = item?.closest('.drop-zone'); const placementCorrect = zone?.dataset.zoneId === answer.zone_id; item?.classList.toggle('placement-correct', placementCorrect); item?.classList.toggle('placement-wrong', !placementCorrect); return placementCorrect; }); }
    if (correct) score += points; section.classList.toggle('correct', correct); section.classList.toggle('incorrect', !correct); section.querySelector('.feedback').textContent = correct ? 'Верно' : 'Проверьте ответ';
  });
  const percentage = maxScore ? Math.round(score / maxScore * 100) : 0; setLoading(true);
  try { const needsReview = openAnswers.length > 0, data = { homework: state.homework.id, student: state.student.id, score, max_score: maxScore, percentage, status: needsReview ? 'needs_review' : 'completed', open_answers: openAnswers, completed_at: new Date().toISOString() }; const existing = await pb.collection('homework_results').getFirstListItem(`homework="${state.homework.id}" && student="${state.student.id}"`, { requestKey: null }).catch(() => null); state.result = existing ? await pb.collection('homework_results').update(existing.id, data) : await pb.collection('homework_results').create(data); el('worksheet-score').textContent = needsReview ? (maxScore ? `Автопроверка: ${score}/${maxScore} · ответ ожидает проверки` : 'Ответ отправлен преподавателю') : `Результат: ${score}/${maxScore} · ${percentage}%`; toast(needsReview ? 'Ответ отправлен преподавателю' : 'Результат сохранён'); } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

function shuffle(items) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }

function skillsMarkup(progress) { return skills.map(([key, label, icon]) => { const value = Number(progress?.[key] || 0); return `<div class="skill-row"><span class="skill-icon ${key}">${icon}</span><span>${label}</span><div class="bar"><div class="bar-fill ${key}" data-width="${value}"></div></div><span class="value">${value}%</span></div>`; }).join(''); }
function bindHomeworkButtons() { document.querySelectorAll('.open-homework').forEach((button) => button.addEventListener('click', () => { const selected = (state.homeworks || []).find((homework) => homework.id === button.dataset.homeworkId); if (!selected) { toast('Домашнее задание не найдено.'); return; } state.homework = selected; navigate('task'); })); }
function animateBars() { requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.bar-fill').forEach((bar) => { bar.style.width = `${Math.max(0, Math.min(100, Number(bar.dataset.width)))}%`; }))); }
function average(progress) { return Math.round(skills.reduce((sum, [key]) => sum + Number(progress?.[key] || 0), 0) / skills.length); }
function formatDate(value, time = false) { if (!value) return 'не указан'; const date = new Date(value.replace(' ', 'T')); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date); }
function normalize(value) { return String(value).trim().toLocaleLowerCase('en-US').replace(/[.!?]+$/, ''); }
function initials(value) { return String(value).split(/[ @.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join(''); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAttr(value) { return escapeHtml(value); }
function setLoading(on) { el('loading').classList.toggle('hidden', !on); }
function toast(message) { el('toast').textContent = message; el('toast').classList.add('visible'); setTimeout(() => el('toast').classList.remove('visible'), 3200); }
function handleFatal(error) { console.error(error); const message = error?.response?.message || error.message || 'Произошла ошибка.'; toast(message); if (error?.status === 401 || error?.status === 403) { if (!pb.authStore.isValid) logout(); } }
