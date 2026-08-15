/* global PocketBase */
const PB_URL = 'http://127.0.0.1:8090';
const pb = new PocketBase(PB_URL);

const el = (id) => document.getElementById(id);
const state = { role: '', route: 'home', students: [], student: null, progress: null, homework: null, tasks: [], result: null, editingStudentId: null, homeworkStudentId: null, questionCount: 0 };
const skills = [
  ['vocabulary', 'Vocabulary', 'V'], ['grammar', 'Grammar', 'G'], ['reading', 'Reading', 'R'],
  ['listening', 'Listening', 'L'], ['speaking', 'Speaking', 'S'],
];

document.addEventListener('DOMContentLoaded', () => {
  el('login-form').addEventListener('submit', login);
  el('logout-button').addEventListener('click', logout);
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
function logout() { pb.authStore.clear(); Object.assign(state, { role: '', route: 'home', students: [], student: null, progress: null, homework: null, tasks: [], result: null }); showLogin(); }

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
  state.route = route; setLoading(true);
  try {
    document.querySelectorAll('[data-route]').forEach((button) => button.classList.toggle('active', button.dataset.route === route || (route === 'task' && button.dataset.route === 'homework')));
    if (state.role === 'parent') await loadParentData(); else await loadTeacherData();
    if (state.role === 'teacher' && route === 'materials') await renderMaterials();
    else if (state.role === 'teacher' && route === 'worksheet-builder') await renderWorksheetBuilder();
    else if (state.role === 'teacher') renderTeacher();
    else if (route === 'task') await renderTask();
    else if (route === 'homework') renderHomeworkOverview();
    else if (route === 'progress') renderProgressPage();
    else renderParentHome();
  } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

async function loadParentData() {
  state.student = await pb.collection('students').getFirstListItem('', { requestKey: null });
  const [progressResult, homeworkResult, resultsResult] = await Promise.allSettled([
    pb.collection('progress').getFirstListItem(`student="${state.student.id}"`, { requestKey: null }),
    pb.collection('homework').getList(1, 1, {
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
  state.homework = homeworkResult.status === 'fulfilled' ? homeworkResult.value.items[0] || null : null;
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
  if (!state.homework) return '<section class="card homework-card"><div class="card-title"><div class="icon-box">✓</div><h2>Текущее ДЗ</h2></div><div class="empty-state">Пока нет домашнего задания</div></section>';
  return `<section class="card homework-card"><div class="card-title"><div class="icon-box">▤</div><h2>Текущее ДЗ</h2></div><h3 class="homework-title">${escapeHtml(state.homework.title)}</h3>${state.homework.instructions ? `<p class="homework-instructions">${escapeHtml(state.homework.instructions)}</p>` : ''}<p class="muted">Срок: ${formatDate(state.homework.due_date, true)}</p><button class="primary-button open-homework" type="button">Открыть задание &nbsp;→</button></section>`;
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
  el('content').innerHTML = `<section class="card table-card"><table class="student-table"><thead><tr><th>Ученик</th><th>Текущая тема</th><th>Прогресс</th><th>Действия</th><th>Текущее ДЗ</th><th>Последний результат</th></tr></thead><tbody>${state.students.map((student) => {
    const progress = d.progress.find((x) => x.student === student.id); const homework = d.homework.find((x) => x.student === student.id); const result = d.results.find((x) => x.student === student.id);
    const isEditing = state.editingStudentId === student.id;
    return `<tr data-student-row="${student.id}"><td><strong>${escapeHtml(student.name)}</strong><div class="muted">${escapeHtml(student.course || 'English')} · ${escapeHtml(student.level || '—')}</div></td><td>${escapeHtml(student.current_topic || '—')}</td><td>${isEditing ? progressEditor(progress) : teacherProgressMarkup(progress)}</td><td>${isEditing ? `<div class="edit-actions"><button class="primary-button save-progress" data-student-id="${student.id}" type="button">Сохранить</button><button class="secondary-button cancel-progress" type="button">Отмена</button></div>` : `<div class="row-actions"><button class="secondary-button edit-progress" data-student-id="${student.id}" type="button">Изменить прогресс</button><button class="primary-button create-homework" data-student-id="${student.id}" type="button">Создать ДЗ</button></div>`}</td><td>${homework ? `<strong>${escapeHtml(homework.title)}</strong><div class="muted">до ${formatDate(homework.due_date)}</div>` : '—'}</td><td>${result ? teacherResultMarkup(result) : '—'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">Ученики пока не добавлены.</td></tr>'}</tbody></table></section>`;
  bindTeacherProgressControls(); animateBars();
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
    state.homeworkStudentId = button.dataset.studentId; state.questionCount = 0; renderTeacher();
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

async function renderMaterials() {
  const materials = await pb.collection('materials').getFullList({ sort: 'title', requestKey: null });
  setHeader('Материалы', 'Файлы для подготовки интерактивных рабочих листов.', 'Личная библиотека');
  el('content').innerHTML = `<div class="materials-layout"><form id="material-form" class="card material-form"><div class="card-title"><h2>Добавить материал</h2></div><label>Название<input name="title" required></label><label>Файл<input name="file" type="file" required accept=".pdf,.doc,.docx,.ppt,.pptx,image/jpeg,image/png"></label><button class="primary-button" type="submit">Добавить в библиотеку</button></form>
    <section class="grid material-list">${materials.map((material) => `<article class="card material-card"><p class="eyebrow">${escapeHtml(materialFileType(material.file))}</p><h2>${escapeHtml(material.title)}</h2><p class="muted file-name">${escapeHtml(material.file || 'Файл не загружен')}</p><div class="material-actions">${material.file ? `<a class="secondary-button" href="${escapeAttr(pb.files.getURL(material, material.file))}" target="_blank" rel="noopener">Открыть</a>` : ''}<button class="secondary-button rename-material" data-id="${material.id}" data-title="${escapeAttr(material.title)}" type="button">Переименовать</button><label class="secondary-button replace-file">Заменить файл<input data-id="${material.id}" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,image/jpeg,image/png"></label><button class="danger-button delete-material" data-id="${material.id}" type="button">Удалить</button></div></article>`).join('') || '<div class="card empty-state">В библиотеке пока нет материалов.</div>'}</section></div>`;
  el('material-form').addEventListener('submit', saveMaterial);
  document.querySelectorAll('.rename-material').forEach((button) => button.addEventListener('click', () => renameMaterial(button)));
  document.querySelectorAll('.replace-file input').forEach((input) => input.addEventListener('change', () => replaceMaterialFile(input)));
  document.querySelectorAll('.delete-material').forEach((button) => button.addEventListener('click', () => deleteMaterial(button.dataset.id)));
}

async function saveMaterial(event) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData();
  data.set('title', form.elements.title.value.trim()); data.set('created_by', pb.authStore.record.id); data.set('file', form.elements.file.files[0]);
  setLoading(true); try { await pb.collection('materials').create(data); toast('Материал добавлен'); await renderMaterials(); } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

function materialFileType(file) { const extension = String(file || '').split('.').pop().toUpperCase(); return extension || 'Документ'; }
async function renameMaterial(button) { const title = window.prompt('Новое название материала', button.dataset.title); if (!title?.trim()) return; setLoading(true); try { await pb.collection('materials').update(button.dataset.id, { title: title.trim() }); toast('Материал переименован'); await renderMaterials(); } catch (error) { handleFatal(error); } finally { setLoading(false); } }
async function replaceMaterialFile(input) { if (!input.files[0]) return; const data = new FormData(); data.set('file', input.files[0]); setLoading(true); try { await pb.collection('materials').update(input.dataset.id, data); toast('Файл заменён'); await renderMaterials(); } catch (error) { handleFatal(error); } finally { setLoading(false); } }
async function deleteMaterial(id) { if (!window.confirm('Удалить материал? Это действие нельзя отменить.')) return; setLoading(true); try { const [sources, worksheets] = await Promise.all([pb.collection('worksheet_sources').getList(1, 1, { filter: `material="${id}"`, requestKey: null }), pb.collection('worksheets').getList(1, 1, { filter: `source_material="${id}"`, requestKey: null })]); if (sources.totalItems || worksheets.totalItems) { toast('Материал используется в worksheet. Сначала отвяжите его.'); return; } await pb.collection('materials').delete(id); toast('Материал удалён'); await renderMaterials(); } catch (error) { handleFatal(error); } finally { setLoading(false); } }

async function renderWorksheetBuilder() {
  const [materials, sections] = await Promise.all([pb.collection('materials').getFullList({ sort: 'title', requestKey: null }), pb.collection('material_sections').getFullList({ sort: 'order', requestKey: null })]);
  state.builderMaterials = materials; state.builderSections = sections; state.questionCount = 0;
  setHeader('Создать worksheet', 'Интерактивный рабочий лист для ученика.', 'Worksheet Builder');
  el('content').innerHTML = `<form id="worksheet-form" class="worksheet-builder card"><section class="builder-step"><span>Шаг 1</span><h2>Ученик</h2><select name="student" required><option value="">Выберите ученика</option>${state.students.map((student) => `<option value="${student.id}">${escapeHtml(student.name)}</option>`).join('')}</select></section>
    <section class="builder-step"><span>Шаг 2</span><h2>Источники</h2><p class="muted">Можно одновременно выбрать несколько материалов и загрузить несколько файлов.</p><div class="source-picker"><div><strong>Из библиотеки</strong><div class="library-checklist">${materials.map((m) => `<label><input type="checkbox" name="library_sources" value="${m.id}"> ${escapeHtml(m.title)}</label>`).join('') || '<p class="muted">Библиотека пуста</p>'}</div></div><label>Страницы / сканы<input name="source_files" type="file" multiple accept="image/jpeg,image/png,application/pdf"></label></div><div id="selected-sources" class="selected-sources"><span class="muted">Источники не выбраны</span></div></section>
    <section class="builder-step"><span>Шаг 3</span><h2>Параметры worksheet</h2><div class="form-grid"><label class="full-field">Цель / что отработать<textarea name="learning_goal" rows="3" required placeholder="Past Simple irregular verbs"></textarea></label><label>Название worksheet<input name="title" required placeholder="Past Simple review"></label><label>Срок<input name="due_date" type="datetime-local"></label></div></section>
    <section id="review-section" class="builder-step"><span>Шаг 4</span><div class="questions-heading"><div><h2>Упражнения</h2><p class="muted">Добавьте задания и проверьте worksheet перед публикацией.</p></div><button id="add-exercise" class="secondary-button" type="button">+ Добавить упражнение</button></div><div class="review-toolbar"><button id="preview-worksheet" class="secondary-button" type="button">Предпросмотр как ученик</button></div><div id="exercise-list"></div></section>
    <p id="worksheet-error" class="form-error"></p><div id="publish-actions" class="homework-actions"><button class="secondary-button" data-status="draft" type="submit">Сохранить черновик</button><button class="primary-button" data-status="published" type="submit">Опубликовать</button><button id="cancel-worksheet" class="secondary-button" type="button">Отмена</button></div></form><dialog id="worksheet-preview-dialog" class="preview-dialog"><div id="worksheet-preview-content"></div><button id="close-preview" class="secondary-button" type="button">Закрыть предпросмотр</button></dialog>`;
  document.querySelectorAll('[name="library_sources"]').forEach((checkbox) => checkbox.addEventListener('change', updateSelectedSources));
  el('worksheet-form').elements.source_files.addEventListener('change', updateSelectedSources);
  el('add-exercise').addEventListener('click', () => addWorksheetExercise()); el('cancel-worksheet').addEventListener('click', () => navigate('home')); el('worksheet-form').addEventListener('submit', saveWorksheet);
  el('preview-worksheet').addEventListener('click', showBuilderPreview); el('close-preview').addEventListener('click', () => el('worksheet-preview-dialog').close());
  addWorksheetExercise();
}

function updateSelectedSources() { const form = el('worksheet-form'); const selected = [...form.querySelectorAll('[name="library_sources"]:checked')].map((input) => ({ type: 'library', id: input.value, label: state.builderMaterials.find((m) => m.id === input.value)?.title || 'Материал' })); const uploads = [...form.elements.source_files.files].map((file) => ({ type: 'upload', label: file.name })); const items = [...selected, ...uploads]; el('selected-sources').innerHTML = items.length ? items.map((item) => `<span class="source-chip">${item.type === 'library' ? '▦' : '↥'} ${escapeHtml(item.label)}</span>`).join('') : '<span class="muted">Источники не выбраны</span>'; }

function addWorksheetExercise(exercise = null) {
  const index = state.questionCount++; const node = document.createElement('section'); node.className = 'exercise-editor'; node.dataset.exerciseIndex = index;
  node.innerHTML = `<div class="question-editor-head"><strong>Блок ${index + 1}</strong><div><button class="edit-exercise" type="button">Редактировать</button><button class="move-exercise" data-direction="up" type="button">↑</button><button class="move-exercise" data-direction="down" type="button">↓</button><button class="remove-question" type="button">Удалить</button></div></div><div class="exercise-summary"></div><div class="exercise-edit-fields"><label>Тип<select name="type"><optgroup label="Проверяемые упражнения"><option value="multiple_choice">Multiple choice</option><option value="text_input">Text input</option><option value="reorder_words">Reorder words</option><option value="matching">Matching</option><option value="dropdown">Dropdown</option><option value="drag_drop">Drag & Drop</option></optgroup><optgroup label="Ответ преподавателю"><option value="open_text_teacher_review">Open text — teacher review</option></optgroup><optgroup label="Контент"><option value="video_embed">Video embed</option><option value="embed">Generic embed</option></optgroup></select></label><label class="block-title hidden">Заголовок (необязательно)<input name="title"></label><label>Инструкция / вопрос<textarea name="instruction" rows="2" required></textarea></label><div class="exercise-fields"></div><label class="points-field">Баллы<input name="points" type="number" min="1" value="1"></label><button class="primary-button finish-edit" type="button">Готово</button></div>`;
  el('exercise-list').appendChild(node); renderExerciseFields(node, 'multiple_choice');
  node.querySelector('[name="type"]').addEventListener('change', (e) => renderExerciseFields(node, e.target.value)); node.querySelector('.remove-question').addEventListener('click', () => node.remove());
  node.querySelectorAll('.move-exercise').forEach((button) => button.addEventListener('click', () => moveExercise(node, button.dataset.direction)));
  node.querySelector('.edit-exercise').addEventListener('click', () => node.classList.add('editing')); node.querySelector('.finish-edit').addEventListener('click', () => { node.classList.remove('editing'); updateExerciseSummary(node); });
  if (exercise) fillExerciseEditor(node, exercise); else node.classList.add('editing'); updateExerciseSummary(node);
}

function fillExerciseEditor(node, exercise) { const type = exercise.type || 'multiple_choice'; node.querySelector('[name="type"]').value = type; renderExerciseFields(node, type); node.querySelector('[name="instruction"]').value = exercise.instruction || ''; node.querySelector('[name="title"]').value = exercise.title || ''; node.querySelector('[name="points"]').value = exercise.points || 1;
  if (exercise._recordId) node.dataset.recordId = exercise._recordId;
  if (type === 'multiple_choice') { (exercise.content?.options || []).slice(0, 4).forEach((value, i) => { node.querySelector(`[name="option_${i + 1}"]`).value = value; }); const correct = Array.isArray(exercise.correct_answer) ? exercise.correct_answer[0] : exercise.correct_answer; const index = (exercise.content?.options || []).indexOf(correct); node.querySelector('[name="correct_option"]').value = String(Math.max(0, index) + 1); }
  if (type === 'text_input') node.querySelector('[name="answers"]').value = (exercise.correct_answer || []).join(' | ');
  if (type === 'reorder_words') node.querySelector('[name="sentence"]').value = (exercise.correct_answer || []).join(' ');
  if (type === 'matching') node.querySelector('[name="pairs"]').value = Object.entries(exercise.correct_answer || {}).map(([left, right]) => `${left} = ${right}`).join('\n');
  if (type === 'dropdown') renderDropdownEditor(node, exercise.content?.items || []);
  if (type === 'drag_drop') renderDragDropEditor(node, exercise.content || {});
  if (type === 'open_text_teacher_review') { node.querySelector('[name="open_prompt"]').value = exercise.content?.prompt || ''; node.querySelector('[name="open_placeholder"]').value = exercise.content?.placeholder || ''; node.querySelector('[name="success_criteria"]').value = (exercise.content?.success_criteria || []).join('\n'); }
}
function updateExerciseSummary(node) { const type = node.querySelector('[name="type"]').value, instruction = node.querySelector('[name="instruction"]').value.trim(); node.querySelector('.exercise-summary').innerHTML = `<span class="type-pill">${escapeHtml(type.replace('_', ' '))}</span><strong>${escapeHtml(instruction || 'Новое упражнение')}</strong>`; }

function renderExerciseFields(node, type) {
  const fields = node.querySelector('.exercise-fields');
  const isMedia = ['video_embed', 'embed'].includes(type), hasScore = !isMedia && type !== 'open_text_teacher_review'; node.querySelector('.block-title').classList.toggle('hidden', !isMedia); node.querySelector('.points-field').classList.toggle('hidden', !hasScore); node.querySelector('[name="instruction"]').required = !isMedia;
  if (type === 'multiple_choice') fields.innerHTML = `${[1,2,3,4].map((n) => `<label>Вариант ${n}<input name="option_${n}" required></label>`).join('')}<label>Правильный вариант<select name="correct_option">${[1,2,3,4].map((n) => `<option value="${n}">Вариант ${n}</option>`).join('')}</select></label>`;
  if (type === 'text_input') fields.innerHTML = '<label>Допустимые ответы через |<input name="answers" placeholder="don\'t | do not" required></label>';
  if (type === 'reorder_words') fields.innerHTML = '<label>Правильное предложение<input name="sentence" placeholder="I usually walk to school." required></label>';
  if (type === 'matching') fields.innerHTML = '<label>Пары, каждая с новой строки, формат left = right<textarea name="pairs" rows="5" placeholder="go = went\nsee = saw" required></textarea></label>';
  if (type === 'dropdown') renderDropdownEditor(node);
  if (type === 'drag_drop') renderDragDropEditor(node);
  if (type === 'open_text_teacher_review') fields.innerHTML = '<label>Prompt<textarea name="open_prompt" rows="2" required placeholder="Describe the picture."></textarea></label><label>Placeholder<input name="open_placeholder" placeholder="Type your answer here..."></label><label>Критерии успеха, каждый с новой строки<textarea name="success_criteria" rows="4" required placeholder="Write 2 sentences\nUse is once\nUse isn\'t once"></textarea></label>';
  if (type === 'video_embed') fields.innerHTML = '<label>Ссылка на видео или embed URL<input name="embed_input" type="url" placeholder="https://rutube.ru/video/..." required></label>';
  if (type === 'embed') fields.innerHTML = '<label>Embed URL или iframe-код<textarea name="embed_input" rows="3" placeholder="https://... или <iframe src=&quot;https://...&quot;></iframe>" required></textarea><small class="muted">Будет сохранён только безопасный URL из src. HTML и скрипты не выполняются.</small></label>';
}
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

function showBuilderPreview() { const nodes = [...document.querySelectorAll('.exercise-editor')], exercises = nodes.map((node, order) => ({ id: `preview-${order}`, ...readWorksheetExercise(node, order) })).filter(Boolean); const form = el('worksheet-form'); el('worksheet-preview-content').innerHTML = `<div class="worksheet-page"><div class="worksheet-intro"><p class="eyebrow">Предпросмотр как ученик</p><h2>${escapeHtml(form.elements.title.value || 'Worksheet')}</h2><p>${escapeHtml(form.elements.learning_goal.value)}</p></div>${exercises.map(worksheetExerciseMarkup).join('')}</div>`; bindDragDrop(el('worksheet-preview-content')); el('worksheet-preview-dialog').showModal(); }

async function saveWorksheet(event) {
  event.preventDefault(); const form = event.currentTarget; const status = event.submitter?.dataset.status || 'draft'; const nodes = [...form.querySelectorAll('.exercise-editor')];
  el('worksheet-error').textContent = ''; if (!nodes.length) { el('worksheet-error').textContent = 'Добавьте хотя бы одно упражнение.'; return; }
  const exercises = nodes.map((node, order) => readWorksheetExercise(node, order)); if (exercises.some((x) => !x)) { el('worksheet-error').textContent = 'Проверьте заполнение упражнений.'; return; }
  const selectedMaterials = [...form.querySelectorAll('[name="library_sources"]:checked')].map((input) => input.value); const due = form.elements.due_date.value; setLoading(true);
  try {
    const worksheet = await pb.collection('worksheets').create({ student: form.elements.student.value, title: form.elements.title.value.trim(), instructions: form.elements.learning_goal.value.trim(), status: 'draft', due_date: due ? new Date(due).toISOString() : '', created_by: pb.authStore.record.id });
    for (const exercise of exercises) await pb.collection('worksheet_exercises').create({ ...exercise, worksheet: worksheet.id });
    let sourceOrder = 0;
    for (const material of selectedMaterials) await pb.collection('worksheet_sources').create({ worksheet: worksheet.id, material, source_type: 'library', order: sourceOrder++ });
    for (const file of [...form.elements.source_files.files]) { const data = new FormData(); data.set('worksheet', worksheet.id); data.set('uploaded_file', file); data.set('source_type', 'upload'); data.set('order', sourceOrder++); await pb.collection('worksheet_sources').create(data); }
    const homework = await pb.collection('homework').create({ student: form.elements.student.value, title: form.elements.title.value.trim(), instructions: form.elements.learning_goal.value.trim(), due_date: due ? new Date(due).toISOString() : '', status, created_by: pb.authStore.record.id, worksheet: worksheet.id });
    if (status === 'published') await pb.collection('worksheets').update(worksheet.id, { status: 'published' });
    state.teacherData.homework.unshift(homework); toast(status === 'published' ? 'Worksheet опубликован' : 'Черновик worksheet сохранён'); await navigate('home');
  } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

function readWorksheetExercise(node, order) {
  const type = node.querySelector('[name="type"]').value, instruction = node.querySelector('[name="instruction"]').value.trim(), points = Number(node.querySelector('[name="points"]').value || 1);
  if (['video_embed', 'embed'].includes(type)) { const embedUrl = normalizeEmbedInput(node.querySelector('[name="embed_input"]').value, type); if (!embedUrl) return null; return { type, title: node.querySelector('[name="title"]').value.trim(), instruction, embed_url: embedUrl, content: {}, correct_answer: null, order, points: 0 }; }
  if (!instruction) return null;
  if (type === 'multiple_choice') { const options = [1,2,3,4].map((n) => node.querySelector(`[name="option_${n}"]`).value.trim()); if (options.some((x) => !x)) return null; return { type, instruction, content: { options }, correct_answer: [options[Number(node.querySelector('[name="correct_option"]').value) - 1]], order, points }; }
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
  el('content').innerHTML = `<form id="worksheet-player" class="worksheet-page"><div class="worksheet-intro"><p class="eyebrow">Интерактивный worksheet</p><h2>${escapeHtml(worksheet.title)}</h2><p>${escapeHtml(worksheet.instructions || '')}</p><div id="worksheet-progress" class="worksheet-progress">Выполнено 0 из ${assessable.length}</div></div>${state.exercises.map(worksheetExerciseMarkup).join('')}<div class="worksheet-submit"><button class="primary-button" type="submit" ${assessable.length || reviewable.length ? '' : 'disabled'}>${reviewable.length ? 'Отправить работу' : 'Проверить работу'}</button><strong id="worksheet-score">${savedStatus}</strong></div></form>`;
  document.querySelectorAll('.word-token').forEach((button) => button.addEventListener('click', toggleWordToken)); document.querySelectorAll('.match-item').forEach((button) => button.addEventListener('click', selectMatchItem)); document.querySelectorAll('.worksheet-answer input, .worksheet-answer select').forEach((input) => input.addEventListener('change', updateWorksheetProgress)); bindDragDrop(document); el('worksheet-player').addEventListener('submit', checkWorksheet);
}

function worksheetExerciseMarkup(exercise, index) {
  let answer = ''; const content = exercise.content || {};
  if (['video_embed', 'embed'].includes(exercise.type)) return embedBlockMarkup(exercise);
  if (exercise.type === 'multiple_choice') answer = content.options.map((option) => `<label class="option"><input type="radio" name="ws-${exercise.id}" value="${escapeAttr(option)}">${escapeHtml(option)}</label>`).join('');
  if (exercise.type === 'text_input') answer = `<input class="text-answer" name="ws-${exercise.id}" autocomplete="off">`;
  if (exercise.type === 'reorder_words') answer = `<div class="word-bank">${content.words.map((word, i) => `<button class="word-token" data-index="${i}" type="button">${escapeHtml(word)}</button>`).join('')}</div><div class="word-answer" data-answer-for="${exercise.id}"></div>`;
  if (exercise.type === 'matching') answer = `<div class="matching-tap"><div class="match-column">${content.left.map((left, pairIndex) => `<button class="match-item match-left" data-pair-index="${pairIndex}" data-value="${escapeAttr(left)}" type="button">${escapeHtml(left)}</button>`).join('')}</div><div class="match-column">${content.right.map((right) => `<button class="match-item match-right" data-value="${escapeAttr(right)}" type="button">${escapeHtml(right)}</button>`).join('')}</div></div>`;
  if (exercise.type === 'dropdown') answer = `<div class="dropdown-exercise">${(content.items || []).map((item, itemIndex) => `<label class="dropdown-sentence"><span>${escapeHtml(item.text_before || '')}</span><select name="ws-${exercise.id}-${itemIndex}" aria-label="Выберите правильный вариант"><option value="">Выберите…</option>${(item.options || []).map((option) => `<option value="${escapeAttr(option)}">${escapeHtml(option)}</option>`).join('')}</select><span>${escapeHtml(item.text_after || '')}</span></label>`).join('')}</div>`;
  if (exercise.type === 'drag_drop') answer = `<div class="drag-drop-exercise"><div class="drag-item-bank drop-target" data-bank="true"><span class="drag-area-label">Элементы</span>${(content.draggable_items || []).map((item) => `<button class="drag-item" type="button" draggable="true" data-item-id="${escapeAttr(item.id)}">${escapeHtml(item.content)}</button>`).join('')}</div><div class="drop-zones">${(content.drop_zones || []).map((zone) => `<div class="drop-zone drop-target" data-zone-id="${escapeAttr(zone.id)}"><strong>${escapeHtml(zone.label)}</strong><div class="drop-zone-items"></div></div>`).join('')}</div><p class="drag-hint">Перетащите элемент или нажмите на него, затем на нужную зону.</p></div>`;
  if (exercise.type === 'open_text_teacher_review') { const saved = savedOpenTextAnswer(exercise.id); answer = `<div class="open-text-review"><h4>${escapeHtml(content.prompt || '')}</h4><ul class="success-criteria">${(content.success_criteria || []).map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join('')}</ul><textarea name="open-${exercise.id}" rows="7" placeholder="${escapeAttr(content.placeholder || 'Введите ответ…')}">${escapeHtml(saved)}</textarea><p class="muted">Ответ проверит преподаватель.</p></div>`; }
  return `<section class="worksheet-exercise" data-exercise="${exercise.id}"><span class="exercise-number">${index + 1}</span><h3>${escapeHtml(exercise.instruction)}</h3><div class="worksheet-answer">${answer}</div><p class="feedback"></p></section>`;
}

function savedOpenTextAnswer(exerciseId) { const answers = Array.isArray(state.result?.open_answers) ? state.result.open_answers : []; return answers.find((item) => item.exercise_id === exerciseId)?.answer || ''; }

function embedBlockMarkup(block) { const label = block.type === 'video_embed' ? 'Видео' : 'Интерактивный материал'; const fallback = block.type === 'video_embed' ? 'Открыть видео' : 'Открыть материал'; return `<section class="worksheet-media-block"><div class="media-block-heading"><span>${label}</span>${block.title ? `<h3>${escapeHtml(block.title)}</h3>` : ''}${block.instruction ? `<p>${escapeHtml(block.instruction)}</p>` : ''}</div><div class="embed-frame-wrap"><iframe src="${escapeAttr(block.embed_url)}" title="${escapeAttr(block.title || label)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture" allowfullscreen></iframe><a class="secondary-button embed-fallback" href="${escapeAttr(block.embed_url)}" target="_blank" rel="noopener noreferrer">${fallback}</a></div></section>`; }

function isAssessableExercise(exercise) { return ['multiple_choice', 'text_input', 'reorder_words', 'matching', 'dropdown', 'drag_drop'].includes(exercise.type) && Number(exercise.points || 0) > 0; }

function toggleWordToken(event) { const button = event.currentTarget, section = button.closest('.worksheet-exercise'), answer = section.querySelector('.word-answer'); button.classList.toggle('selected'); if (button.classList.contains('selected')) answer.appendChild(button); else section.querySelector('.word-bank').appendChild(button); updateWorksheetProgress(); }
function selectMatchItem(event) { const button = event.currentTarget, section = button.closest('.worksheet-exercise'); if (button.classList.contains('paired')) { const pairId = button.dataset.pairId; section.querySelectorAll(`[data-pair-id="${pairId}"]`).forEach((item) => { item.classList.remove('paired'); delete item.dataset.pairId; }); updateWorksheetProgress(); return; } const side = button.classList.contains('match-left') ? 'left' : 'right'; section.querySelectorAll(`.match-${side}.active`).forEach((item) => item.classList.remove('active')); button.classList.add('active'); const left = section.querySelector('.match-left.active'), right = section.querySelector('.match-right.active'); if (left && right) { const pairId = `${Date.now()}-${Math.random()}`; [left, right].forEach((item) => { item.classList.remove('active'); item.classList.add('paired'); item.dataset.pairId = pairId; }); } updateWorksheetProgress(); }
function moveDragItem(section, itemId, target) { const item = [...section.querySelectorAll('.drag-item')].find((candidate) => candidate.dataset.itemId === itemId); if (!item || !target) return; const destination = target.classList.contains('drop-zone') ? target.querySelector('.drop-zone-items') : target; destination.appendChild(item); section.querySelectorAll('.drag-item.active').forEach((candidate) => candidate.classList.remove('active')); if (section.closest('#worksheet-player')) updateWorksheetProgress(); }
function bindDragDrop(root) { root.querySelectorAll('.drag-drop-exercise').forEach((exercise) => { const section = exercise.closest('.worksheet-exercise'); exercise.querySelectorAll('.drag-item').forEach((item) => { item.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', item.dataset.itemId); event.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); }); item.addEventListener('dragend', () => item.classList.remove('dragging')); item.addEventListener('click', () => { const active = item.classList.contains('active'); section.querySelectorAll('.drag-item.active').forEach((candidate) => candidate.classList.remove('active')); if (!active) item.classList.add('active'); }); }); exercise.querySelectorAll('.drop-target').forEach((target) => { target.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.classList.add('drag-over'); }); target.addEventListener('dragleave', () => target.classList.remove('drag-over')); target.addEventListener('drop', (event) => { event.preventDefault(); target.classList.remove('drag-over'); moveDragItem(section, event.dataTransfer.getData('text/plain'), target); }); target.addEventListener('click', (event) => { if (event.target.closest('.drag-item')) return; const active = section.querySelector('.drag-item.active'); if (active) moveDragItem(section, active.dataset.itemId, target); }); }); }); }
function updateWorksheetProgress() { const assessable = state.exercises.filter(isAssessableExercise); const completed = assessable.filter((exercise) => { const section = document.querySelector(`[data-exercise="${exercise.id}"]`); if (exercise.type === 'multiple_choice') return !!section.querySelector('input:checked'); if (exercise.type === 'text_input') return !!section.querySelector('input').value.trim(); if (exercise.type === 'reorder_words') return section.querySelectorAll('.word-answer .word-token').length > 0; if (exercise.type === 'dropdown') { const selects = [...section.querySelectorAll('.dropdown-sentence select')]; return selects.length > 0 && selects.every((select) => select.value !== ''); } if (exercise.type === 'drag_drop') { const items = section.querySelectorAll('.drag-item').length; return items > 0 && section.querySelectorAll('.drop-zone .drag-item').length === items; } return section.querySelectorAll('.match-left.paired').length === section.querySelectorAll('.match-left').length; }).length; el('page-kicker').textContent = `${completed} из ${assessable.length}`; const indicator = el('worksheet-progress'); if (indicator) indicator.textContent = `Выполнено ${completed} из ${assessable.length}`; }

async function checkWorksheet(event) {
  event.preventDefault(); let score = 0, maxScore = 0; const reviewExercises = state.exercises.filter((exercise) => exercise.type === 'open_text_teacher_review'), openAnswers = reviewExercises.map((exercise) => ({ exercise_id: exercise.id, prompt: exercise.content?.prompt || '', answer: document.querySelector(`[data-exercise="${exercise.id}"] textarea`).value.trim() }));
  if (openAnswers.some((item) => !item.answer)) { toast('Заполните открытый ответ перед отправкой'); document.querySelector(`[data-exercise="${openAnswers.find((item) => !item.answer).exercise_id}"] textarea`).focus(); return; }
  state.exercises.filter(isAssessableExercise).forEach((exercise) => { const section = document.querySelector(`[data-exercise="${exercise.id}"]`); const points = Number(exercise.points); maxScore += points; let correct = false;
    if (exercise.type === 'multiple_choice') { correct = (exercise.correct_answer || []).some((a) => normalize(a) === normalize(section.querySelector('input:checked')?.value || '')); section.querySelectorAll('.option').forEach((option) => { const input = option.querySelector('input'); option.classList.toggle('correct-option', (exercise.correct_answer || []).some((answer) => normalize(answer) === normalize(input.value))); option.classList.toggle('wrong-option', input.checked && !correct); }); }
    if (exercise.type === 'text_input') correct = (exercise.correct_answer || []).some((a) => normalize(a) === normalize(section.querySelector('input').value));
    if (exercise.type === 'reorder_words') correct = JSON.stringify([...section.querySelectorAll('.word-answer .word-token')].map((b) => b.textContent)) === JSON.stringify(exercise.correct_answer || []);
    if (exercise.type === 'matching') correct = Object.entries(exercise.correct_answer || {}).every(([left, right]) => { const leftItem = [...section.querySelectorAll('.match-left')].find((item) => item.dataset.value === left); const pairedRight = [...section.querySelectorAll('.match-right')].find((item) => item.dataset.pairId && item.dataset.pairId === leftItem?.dataset.pairId); return pairedRight?.dataset.value === right; });
    if (exercise.type === 'dropdown') { const items = exercise.content?.items || [], selects = [...section.querySelectorAll('.dropdown-sentence select')]; correct = items.length > 0 && selects.length === items.length && items.every((item, index) => selects[index].value === item.correct_answer); selects.forEach((select, index) => { select.classList.toggle('correct-answer', select.value === items[index]?.correct_answer); select.classList.toggle('wrong-answer', select.value !== items[index]?.correct_answer); }); }
    if (exercise.type === 'drag_drop') { const answers = exercise.content?.answers || []; correct = answers.length > 0 && answers.every((answer) => { const item = [...section.querySelectorAll('.drag-item')].find((candidate) => candidate.dataset.itemId === answer.item_id), zone = item?.closest('.drop-zone'); const placementCorrect = zone?.dataset.zoneId === answer.zone_id; item?.classList.toggle('placement-correct', placementCorrect); item?.classList.toggle('placement-wrong', !placementCorrect); return placementCorrect; }); }
    if (correct) score += points; section.classList.toggle('correct', correct); section.classList.toggle('incorrect', !correct); section.querySelector('.feedback').textContent = correct ? 'Верно' : 'Проверьте ответ';
  });
  const percentage = maxScore ? Math.round(score / maxScore * 100) : 0; setLoading(true);
  try { const needsReview = openAnswers.length > 0, data = { homework: state.homework.id, student: state.student.id, score, max_score: maxScore, percentage, status: needsReview ? 'needs_review' : 'completed', open_answers: openAnswers, completed_at: new Date().toISOString() }; const existing = await pb.collection('homework_results').getFirstListItem(`homework="${state.homework.id}" && student="${state.student.id}"`, { requestKey: null }).catch(() => null); state.result = existing ? await pb.collection('homework_results').update(existing.id, data) : await pb.collection('homework_results').create(data); el('worksheet-score').textContent = needsReview ? (maxScore ? `Автопроверка: ${score}/${maxScore} · ответ ожидает проверки` : 'Ответ отправлен преподавателю') : `Результат: ${score}/${maxScore} · ${percentage}%`; toast(needsReview ? 'Ответ отправлен преподавателю' : 'Результат сохранён'); } catch (error) { handleFatal(error); } finally { setLoading(false); }
}

function shuffle(items) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }

function skillsMarkup(progress) { return skills.map(([key, label, icon]) => { const value = Number(progress?.[key] || 0); return `<div class="skill-row"><span class="skill-icon ${key}">${icon}</span><span>${label}</span><div class="bar"><div class="bar-fill ${key}" data-width="${value}"></div></div><span class="value">${value}%</span></div>`; }).join(''); }
function bindHomeworkButtons() { document.querySelectorAll('.open-homework').forEach((button) => button.addEventListener('click', () => navigate('task'))); }
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
