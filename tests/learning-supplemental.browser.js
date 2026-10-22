// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；需要本地静态服务 4188。
// 通过真实 UI 检查题库、专项、错题重练和指标课程的分流、进度持久化及阶段隔离。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const target = await context.newPage();
  const errors = [];
  const failures = [];
  const checkpoints = [];
  target.on('pageerror', error => errors.push(error.message));
  target.on('dialog', dialog => dialog.accept());
  await target.route('https://fapi.binance.com/**', route => route.abort());
  await target.route('https://www.okx.com/**', route => route.abort());
  await target.route('**/unpkg.com/**', route => route.abort());

  const check = (condition, message) => { if (!condition) failures.push(message); };
  const read = () => target.evaluate(() => ({
    activeWorkspace,
    flow: trainingState.flow,
    questionIndex: trainingState.index,
    stage: stageState.active,
    stageProgress: stageState.progress.map(item => ({ ...item })),
    supplemental: JSON.parse(localStorage.getItem('trend-lab-supplemental-progress') || '{}'),
    mistakes: JSON.parse(localStorage.getItem('trend-lab-mistakes') || '[]'),
    questionCount: questions.length,
    specialCount: specialTrainings.length,
    coverageCount: document.querySelectorAll('[data-coverage-index]').length,
    specialButtons: document.querySelectorAll('.special-btn').length,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
  }));
  const openPractice = async () => {
    await target.locator('[data-subworkspace="practice"]').click();
    await target.waitForFunction(() => activeWorkspace === 'practice');
  };
  const answerCurrent = async (correct) => {
    const question = await target.evaluate(() => ({ good: questions[trainingState.index].good, evidence: questions[trainingState.index].evidence }));
    for (const evidence of question.evidence) await target.locator(`.evidence-check input[value="${evidence}"]`).check();
    await target.locator('#continueToDecision').click();
    const answer = correct ? question.good : await target.locator('.answer-btn').evaluateAll(buttons => buttons.find(button => button.dataset.answer !== questions[trainingState.index].good).dataset.answer);
    await target.locator(`.answer-btn[data-answer="${answer}"]`).click();
    await target.locator('#submitAnswer').click();
    await target.waitForFunction(() => trainingState.answered);
  };

  try {
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'home');
    let current = await read();
    check(current.questionCount === 19 && current.specialCount === 20, `unexpected catalog counts: ${current.questionCount} questions / ${current.specialCount} specials`);
    check(current.coverageCount === 19, `home coverage map contains ${current.coverageCount}, expected 19`);
    const initialProgress = JSON.stringify(current.stageProgress);
    checkpoints.push({ name: 'catalog-counts', questions: current.questionCount, specials: current.specialCount, coverage: current.coverageCount });

    await openPractice();
    await target.locator('#specialTrainingDetails > summary').click();
    await target.locator('[data-special-group="反转与形态"]').click();
    await target.locator('.special-btn[data-special="19"]').click();
    check((await target.locator('#specialDetail').innerText()).includes('专项 · 双顶确认'), 'selected double-top training details were not rendered');
    await target.locator('[data-start-special="19"]').click();
    await target.waitForFunction(() => activeWorkspace === 'market' && !document.querySelector('#specialPracticePrompt').hidden);
    await target.locator('#specialPracticePrompt').scrollIntoViewIfNeeded();
    await target.waitForTimeout(100);
    check((await target.locator('#specialPracticePrompt').innerText()).includes('双顶确认'), 'chart prompt did not identify the selected special');
    await target.locator('[data-special-practice-next]').click();
    await target.waitForFunction(() => activeWorkspace === 'practice' && trainingState.flow === 'special' && trainingState.index === 17);
    check((await target.locator('#questionRouteContext').innerText()).includes('不计入阶段门槛'), 'special question did not disclose its independent progress route');
    await answerCurrent(true);
    current = await read();
    check(JSON.stringify(current.stageProgress) === initialProgress, 'special answer changed stage progress');
    check(current.supplemental['-20']?.attempts === 1 && current.supplemental['-20']?.correct === 1, 'the last special did not save its separate progress key');
    check((await target.locator('#feedback').innerText()).includes('两个相近高点不是确认信号'), 'special answer did not show its take-away');
    await target.locator('#nextQuestion').click();
    await target.waitForFunction(() => activeWorkspace === 'training');
    check((await target.locator('.special-btn[data-special="19"]').innerText()).includes('已练 1 次 · 完整 1 次'), 'special catalog did not refresh the completion count');
    checkpoints.push({ name: 'special-independent-progress', flow: current.flow, question: current.questionIndex, progress: current.supplemental['-20'] });

    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
    current = await read();
    check(current.supplemental['-20']?.attempts === 1 && current.supplemental['-20']?.correct === 1, 'special progress did not survive refresh');

    if (current.activeWorkspace !== 'home') {
      await target.locator('[data-nav-target="home"]').click();
      await target.waitForFunction(() => activeWorkspace === 'home');
    }
    await target.locator('.home-more-learning > summary').click();
    await target.locator('[data-coverage-index="0"]').click();
    await target.waitForFunction(() => activeWorkspace === 'practice' && trainingState.flow === 'practice' && trainingState.index === 0);
    check((await target.locator('#questionRouteContext').innerText()).includes('独立记录'), 'ordinary question route was not labelled as supplemental');
    await answerCurrent(false);
    current = await read();
    check(JSON.stringify(current.stageProgress) === initialProgress, 'ordinary supplemental answer changed stage progress');
    check(current.mistakes.includes(0), 'incorrect supplemental answer was not added to the mistake list');
    await target.locator('[data-nav-target="home"]').click();
    await target.waitForFunction(() => activeWorkspace === 'home');
    if (!(await target.locator('.home-more-learning').evaluate(element => element.open))) await target.locator('.home-more-learning > summary').click();
    await target.locator('#homeRetryMistakes').click();
    await target.waitForFunction(() => activeWorkspace === 'practice' && trainingState.flow === 'mistake' && trainingState.index === 0);
    check((await target.locator('#questionRouteContext').innerText()).includes('答对且证据完整后'), 'mistake route did not explain its completion rule');
    await answerCurrent(true);
    current = await read();
    check(JSON.stringify(current.stageProgress) === initialProgress, 'mistake retry changed stage progress');
    check(!current.mistakes.includes(0), 'correct retry did not remove the question from the mistake list');
    await target.locator('#nextQuestion').click();
    await target.waitForFunction(() => activeWorkspace === 'home');
    checkpoints.push({ name: 'mistake-retry-removal', mistakes: current.mistakes, stageProgressUnchanged: JSON.stringify(current.stageProgress) === initialProgress });

    await target.locator('[data-subworkspace="indicators"]').click();
    await target.waitForFunction(() => activeWorkspace === 'indicators');
    const relatedQuestion = target.locator('[data-indicator-question]').first();
    await relatedQuestion.click();
    await target.waitForFunction(() => activeWorkspace === 'practice' && trainingState.flow === 'indicator');
    current = await read();
    check((await target.locator('#questionRouteContext').innerText()).includes('指标课程'), 'indicator question route was not labelled');
    await answerCurrent(true);
    current = await read();
    check(JSON.stringify(current.stageProgress) === initialProgress, 'indicator course answer changed stage progress');
    await target.locator('#nextQuestion').click();
    await target.waitForFunction(() => activeWorkspace === 'indicators');
    checkpoints.push({ name: 'indicator-route-is-independent', question: current.questionIndex, flow: current.flow });

    await target.setViewportSize({ width: 390, height: 844 });
    await target.locator('[data-subworkspace="practice"]').click();
    await target.waitForFunction(() => activeWorkspace === 'practice');
    current = await read();
    check(!current.horizontalOverflow, 'practice layout overflows horizontally at 390×844');
    await target.locator('#specialTrainingDetails > summary').click();
    await target.locator('[data-special-group="反转与形态"]').click();
    await target.locator('.special-btn[data-special="19"]').click();
    await target.locator('[data-start-special="19"]').click();
    await target.waitForFunction(() => activeWorkspace === 'market' && !document.querySelector('#specialPracticePrompt').hidden);
    await target.locator('#specialPracticePrompt').scrollIntoViewIfNeeded();
    await target.waitForTimeout(100);
    const mobilePrompt = await target.evaluate(() => {
      const prompt = document.querySelector('#specialPracticePrompt').getBoundingClientRect();
      const chart = document.querySelector('.chart-wrap').getBoundingClientRect();
      const button = document.querySelector('[data-special-practice-next]').getBoundingClientRect();
      return { prompt: { top: prompt.top, bottom: prompt.bottom }, chart: { top: chart.top, bottom: chart.bottom }, button: { top: button.top, bottom: button.bottom }, viewportHeight: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    check(mobilePrompt.prompt.bottom <= mobilePrompt.chart.top + 1, 'mobile special prompt was overlapped by the chart');
    check(!mobilePrompt.overflow, 'special chart route overflows horizontally at 390×844');
    check(mobilePrompt.prompt.top >= -1 && mobilePrompt.button.bottom <= mobilePrompt.viewportHeight + 1, 'special chart guidance is not brought into the mobile viewport');
    await target.locator('[data-special-practice-next]').click();
    await target.waitForFunction(() => activeWorkspace === 'practice' && trainingState.flow === 'special');
    check(mobilePrompt.button.bottom > mobilePrompt.prompt.top, 'mobile special action button has no visible hit target');
    await target.setViewportSize({ width: 320, height: 667 });
    current = await read();
    check(!current.horizontalOverflow, 'learning layout overflows horizontally at 320×667');
    await target.locator('[data-nav-target="market"]').click();
    await target.waitForFunction(() => activeWorkspace === 'market');
    await target.setViewportSize({ width: 390, height: 667 });
    current = await read();
    check(!current.horizontalOverflow, 'learning layout overflows horizontally at 390×667');
    checkpoints.push({ name: 'mobile-layout', widths: [390, 320, 390], heights: [844, 667, 667], specialPrompt: mobilePrompt, horizontalOverflow: current.horizontalOverflow });

    await target.evaluate(() => localStorage.setItem('trend-lab-supplemental-progress', JSON.stringify({
      '0': { attempts: 2, correct: 1, lastAt: '2026-10-22T00:00:00.000Z' },
      '19': { attempts: 50, correct: 50, lastAt: '2026-10-22T00:00:00.000Z' },
      '-20': { attempts: 1, correct: 1, lastAt: '2026-10-22T00:00:00.000Z' },
      '-21': { attempts: 50, correct: 50, lastAt: '2026-10-22T00:00:00.000Z' },
      'not-an-id': { attempts: 1, correct: 1, lastAt: '' }
    })));
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
    current = await read();
    check(current.supplemental['0']?.attempts === 2 && current.supplemental['-20']?.attempts === 1, 'valid supplemental progress keys were not preserved during refresh');
    check(current.supplemental['19'] == null && current.supplemental['-21'] == null && current.supplemental['NaN'] == null, 'out-of-range supplemental keys were not removed');
    checkpoints.push({ name: 'supplemental-storage-validation', kept: ['0', '-20'], rejected: ['19', '-21', 'not-an-id'] });

    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    return { passed: failures.length === 0, checkpoints, errors, failures };
  } catch (error) {
    current = await read().catch(() => null);
    failures.push(`${error.message} | state: ${JSON.stringify(current)}`);
    return { passed: false, checkpoints, errors, failures };
  } finally {
    await context.close();
  }
}
