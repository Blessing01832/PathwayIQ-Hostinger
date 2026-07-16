/**
 * This file contains the core intellectual property of the PathwayIQ analysis.
 * It is designed to run in a Node.js environment, completely decoupled from the browser.
 */

// --- HELPERS (Copied from index.html) ---

function sentenceCase(text){
  if(!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  if(!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function withTerminalPunctuation(text){
  if(!text) return "";
  if(/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function withoutTerminalPunctuation(text){
  if(!text || typeof text !== "string") return "";
  return text.trim().replace(/[.!?]+$/g, "");
}

function normalizeStatements(items){
  const unique = new Set();
  return (items || [])
    .map(item => withTerminalPunctuation(sentenceCase(item)))
    .filter(Boolean)
    .filter(item => {
      const key = item.toLowerCase();
      if(unique.has(key)) return false;
      unique.add(key);
      return true;
    });
}

function formatList(items){
  if(!items || items.length === 0) return "";
  if(items.length === 1) return items[0];
  if(items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function normalizeCGPAto100(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return null;
  if (parsed <= 5) return Math.min(Math.max((parsed / 5) * 100, 0), 100);
  if (parsed <= 20) return Math.min(Math.max((parsed / 20) * 100, 0), 100);
  return Math.min(Math.max(parsed, 0), 100);
}

function clamp(value, min, max){
  return Math.min(Math.max(value, min), max);
}

// --- REFACTORED ANALYSIS FUNCTIONS (Now accept 'state' as a parameter) ---

function parseSubjects(subjectText){
  if (!subjectText) return [];
  const lines = subjectText
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  return lines.map(line => {
    const parts = line.split(/[-:–—]/);
    if (parts.length < 2) return null;
    const subject = parts[0].trim().toLowerCase();
    const rawGrade = parts[1].trim().toUpperCase();
    let score = 0;
    const gradeMap = { A1: 95, B2: 85, B3: 80, C4: 75, C5: 70, C6: 65, D7: 55, E8: 45, F9: 30 };
    const mappedScore = gradeMap.hasOwnProperty(rawGrade) ? gradeMap[rawGrade] : parseInt(rawGrade, 10);
    score = Number.isFinite(mappedScore) ? Math.min(Math.max(mappedScore, 0), 100) : 0;
    return { subject, score };
  }).filter(Boolean);
}

function parseCoursework(courseworkText) {
  if (!courseworkText) return [];
  const lines = courseworkText.split("\n").map(line => line.trim()).filter(Boolean);
  const gradeMap = { 'A': 95, 'A-': 92, 'B+': 88, 'B': 85, 'B-': 82, 'C+': 78, 'C': 75, 'D': 65, 'F': 50 };
  return lines
    .filter(line => line.includes('-'))
    .map(line => {
      const parts = line.split(/[-:–—]/);
      if (parts.length < 2) return null;
      const course = parts[0].trim().toLowerCase();
      const rawGrade = parts[1].trim().toUpperCase();
      let score = 0;
      const numericGrade = parseFloat(rawGrade);
      if (!isNaN(numericGrade) && numericGrade >= 0 && numericGrade <= 100) {
        score = numericGrade;
      } else if (gradeMap.hasOwnProperty(rawGrade)) {
        score = gradeMap[rawGrade];
      } else if (gradeMap.hasOwnProperty(rawGrade.charAt(0))) {
        score = gradeMap[rawGrade.charAt(0)];
      }
      return { course, score };
    }).filter(Boolean);
}

function buildProfileSignals(state){
  const stage = state.academicStage;
  const signals = [];
  if(stage === "Secondary School"){
    if(state.interest) signals.push(`interest in ${state.interest}`);
    if(state.career && !state.career.includes("Undecided")) signals.push(`career preference for ${state.career}`);
    if(state.studyDestination) signals.push(`a study destination preference for ${state.studyDestination}`);
    if(state.support) signals.push(`a support priority around ${state.support.toLowerCase()}`);
  }
  if(stage === "Undergraduate"){
    if(state.currentProgram) signals.push(`current studies in ${state.currentProgram}`);
    if(state.specialization) signals.push(`a specialization focus on ${state.specialization}`);
    if(state.career) signals.push(`a long-term objective around ${state.career.toLowerCase()}`);
    if(state.support) signals.push(`an immediate support need in ${state.support.toLowerCase()}`);
  }
  if(stage === "Graduate"){
    if(state.undergraduateDiscipline) signals.push(`an academic foundation in ${state.undergraduateDiscipline}`);
    if(state.targetSpecialization) signals.push(`a target specialization in ${state.targetSpecialization}`);
    if(state.technicalSkills && !state.technicalSkills.includes("None")) signals.push(`technical capability in ${state.technicalSkills}`);
    if(state.careerGoal) signals.push(`a professional objective toward ${state.careerGoal.toLowerCase()}`);
  }
  return signals;
}

function getScoringProfile(state){
  const mode = state.scoringMode === "Standard" ? "Standard" : "Strict";
  if(mode === "Standard"){
    return { mode, componentBaselines: { academic: 35, experience: 30, career: 28, admission: 28, financial: 35 }, strictnessMin: 0.8, thresholds: { high: 16, moderate: 11, developing: 6 } };
  }
  return { mode, componentBaselines: { academic: 25, experience: 20, career: 20, admission: 20, financial: 25 }, strictnessMin: 0.65, thresholds: { high: 17, moderate: 12, developing: 7 } };
}

function computeReadinessCoverage(state){
  const stage = state.academicStage;
  const fieldMap = {
    "Secondary School": ["subjects", "interest", "career", "learningStyle", "extracurricularStrength", "financialConstraint", "admissionConfidence", "studyDestination"],
    "Undergraduate": ["currentProgram", "currentLevel", "cgpa", "specialization", "career", "careerCertainty", "internshipExperience", "support"],
    "Graduate": ["undergraduateDiscipline", "cgpa", "courseworkHistory", "targetSpecialization", "researchInterest", "publicationCount", "advisorPreference", "funding", "careerGoal"]
  };
  const expected = fieldMap[stage] || [];
  if(expected.length === 0) return 1;
  const completed = expected.filter(key => {
    const value = state[key];
    if(value === null || value === undefined) return false;
    if(typeof value === "string") return value.trim().length > 0;
    return true;
  }).length;
  return clamp(completed / expected.length, 0, 1);
}

function enforceStageRecommendationGuardrails(stage, recommendations){
  const bannedPatterns = {
    "Secondary School": [/research/i, /thesis/i, /publication/i, /peer-reviewed/i, /supervisor/i, /manuscript/i, /doctoral/i, /phd/i],
    "Undergraduate": [/waec/i, /neco/i, /final secondary/i],
    "Graduate": [/waec/i, /neco/i, /student government/i]
  };
  const patterns = bannedPatterns[stage] || [];
  const filtered = (recommendations || []).filter(item => !patterns.some(rx => rx.test(item || "")));
  if(filtered.length > 0) return filtered;
  if(stage === "Secondary School"){ return ["Build a focused admission plan by matching your strongest subjects and interests to target university programs."]; }
  if(stage === "Undergraduate"){ return ["Prioritize practical projects and internships that strengthen your specialization profile for next-step opportunities."]; }
  return ["Build a focused graduate progression plan around your specialization, funding strategy, and supervisor-fit criteria."];
}

function buildConfidenceExplanation(state){
  const stage = state.academicStage;
  const drivers = [];
  if(state.subjects) drivers.push("Subject-level data was provided, improving pathway-fit resolution.");
  if(state.cgpa) drivers.push("Academic performance data was provided, strengthening readiness calibration.");
  if(state.career || state.careerGoal) drivers.push("Career-direction inputs were provided, improving trajectory targeting.");
  if(stage === "Graduate"){
    if(state.targetSpecialization) drivers.push("Specialization intent was provided, improving graduate pathway precision.");
    if(state.publicationCount || state.firstAuthor) drivers.push("Research-output indicators were provided, improving competitiveness inference.");
    if(state.advisorPreference) drivers.push("Supervisor-preference data was provided, improving admission strategy relevance.");
  }
  if(stage === "Undergraduate"){
    if(state.specialization) drivers.push("Specialization focus was provided, improving recommendation specificity.");
    if(state.internshipExperience) drivers.push("Experience-level input was provided, improving practical-readiness estimates.");
  }
  if(stage === "Secondary School"){
    if(state.extracurricularStrength) drivers.push("Extracurricular information was provided, improving holistic profile assessment.");
    if(state.studyDestination) drivers.push("Study-destination preference was provided, improving recommendation relevance.");
  }
  const coveragePct = Math.round(computeReadinessCoverage(state) * 100);
  drivers.push(`Profile completeness is approximately ${coveragePct}%, which directly affects confidence.`);
  return normalizeStatements(drivers);
}

function computePathwayScores(subjects){
  const scores = { engineering:0, medicine:0, computing:0, business:0, arts:0 };
  subjects.forEach(item => {
    const s = item.subject;
    const grade = item.score;
    if(s.includes("math") || s.includes("physics")){ scores.engineering += grade * 1.5; }
    if(s.includes("biology") || s.includes("chemistry")){ scores.medicine += grade * 1.5; }
    if(s.includes("computer") || s.includes("ict")){ scores.computing += grade * 1.5; }
    if(s.includes("economics") || s.includes("commerce") || s.includes("accounting")){ scores.business += grade * 1.3; }
    if(s.includes("literature") || s.includes("government")){ scores.arts += grade * 1.2; }
  });
  return scores;
}

function analyzeResearchProfile(state) {
  const textCorpus = `${state.researchInterest || ''}`.toLowerCase();
  function escapeRegExp(str){ return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  const keywordMap = {
    computing: ['python', 'java', 'c++', 'machine learning', 'ml', 'ai', 'artificial intelligence', 'data science', 'tensorflow', 'pytorch', 'nlp', 'natural language processing', 'computer vision', 'algorithm', 'neural network', 'deep learning'],
    biomedical: ['biology', 'biomedical', 'genetics', 'crispr', 'pcr', 'molecular', 'cell', 'cancer', 'neuroscience', 'pharmacology', 'immunology', 'dna', 'rna', 'protein', 'mass spectrometry'],
    engineering: ['matlab', 'autocad', 'solidworks', 'engineering', 'mechanical', 'electrical', 'civil', 'chemical', 'thermodynamics', 'fluid mechanics', 'control systems', 'robotics', 'renewable energy'],
    business: ['finance', 'economics', 'marketing', 'accounting', 'management', 'analytics', 'business', 'logistics', 'financial accounting', 'supply chain'],
    arts: ['literature', 'history', 'art', 'music', 'anthropology', 'culture', 'performing', 'visual art', 'creative writing'],
    health: ['public health', 'epidemiology', 'clinical', 'nursing', 'health economics', 'healthcare', 'biology', 'biomedical', 'biotechnology', 'global health'],
    linguistic: ['linguistics', 'language', 'syntax', 'phonetics', 'sociolinguistics', 'translation']
  };
  let matchedKeywords = [];
  let fieldScores = { computing: 0, biomedical: 0, engineering: 0, business: 0, arts: 0, health: 0, linguistic: 0 };
  for (const field in keywordMap) {
    keywordMap[field].forEach(keyword => {
      const lowered = keyword.toLowerCase();
      const escaped = escapeRegExp(lowered);
      const pattern = `(?<!\\w)${escaped}(?!\\w)`;
      try {
        const regex = new RegExp(pattern, 'g');
        const matches = textCorpus.match(regex);
        if (matches && matches.length > 0) {
          const capitalizedKeyword = keyword.charAt(0).toUpperCase() + keyword.slice(1);
          if (!matchedKeywords.includes(capitalizedKeyword)) matchedKeywords.push(capitalizedKeyword);
          fieldScores[field] += matches.length;
        }
      } catch (err) {
        if (textCorpus.indexOf(lowered) !== -1) {
          const capitalizedKeyword = keyword.charAt(0).toUpperCase() + keyword.slice(1);
          if (!matchedKeywords.includes(capitalizedKeyword)) matchedKeywords.push(capitalizedKeyword);
          fieldScores[field] += 1;
        }
      }
    });
  }
  if (state.technicalSkills) {
    const skill = state.technicalSkills.toLowerCase();
    if (skill.includes('programming') || skill.includes('data analysis')) { fieldScores.computing += 3; }
    else if (skill.includes('lab techniques')) { fieldScores.biomedical += 3; }
    else if (skill.includes('engineering software')) { fieldScores.engineering += 3; }
    else if (skill.includes('statistical software')) { fieldScores.business += 2; }
    else if (skill.includes('qualitative software')) { fieldScores.arts += 2; }
  }
  let topField = null;
  let maxScore = 0;
  for (const field in fieldScores) {
    if (fieldScores[field] > maxScore) { maxScore = fieldScores[field]; topField = field; }
  }
  const mergedFieldScores = {
    'Engineering & Computing': (fieldScores.computing || 0) + (fieldScores.engineering || 0),
    'Biomedical & Biotech': (fieldScores.biomedical || 0),
    'Health Sciences': (fieldScores.health || 0),
    'Arts & Culture': (fieldScores.arts || 0),
    'Linguistic': (fieldScores.linguistic || 0),
    'Business': (fieldScores.business || 0),
    'Other': 0
  };
  const mergedTotal = Object.values(mergedFieldScores).reduce((a,b)=>a+b,0);
  if(mergedTotal === 0){ mergedFieldScores['Other'] = 1; }
  return { matchedKeywords, topField, keywordCount: matchedKeywords.length, fieldScores, mergedFieldScores };
}

function inferPathway(state){
  const stage = state.academicStage;
  const pathwayDisplayNames = { engineering: "Engineering", medicine: "Medicine / Health Sciences", computing: "Computing", business: "Business", arts: "Arts" };
  let primary = "Interdisciplinary Pathway";
  let alternative = null;
  let scores = {};
  let primaryKey = null;
  if (stage === "Secondary School") {
    const parsed = parseSubjects(state.subjects);
    scores = computePathwayScores(parsed);
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    primaryKey = ranked[0][0];
    const alternativeKey = ranked[1] ? ranked[1][0] : null;
    primary = pathwayDisplayNames[primaryKey] || primaryKey.charAt(0).toUpperCase() + primaryKey.slice(1);
    alternative = alternativeKey ? (pathwayDisplayNames[alternativeKey] || alternativeKey.charAt(0).toUpperCase() + alternativeKey.slice(1)) : null;
  } else if (stage === "Undergraduate") {
    primary = "Academic Optimization Pathway";
    primaryKey = "optimization";
    if (state.specialization?.includes("Software")) { primary = "Advanced Computing Specialization"; primaryKey = "computing"; }
    if (state.specialization?.includes("Finance")) { primary = "Business & Financial Systems"; primaryKey = "business"; }
    alternative = "General Academic Development";
    scores = {}; 
  } else if (stage === "Graduate") {
    const researchAnalysis = analyzeResearchProfile(state);
    const specializationInput = (state.targetSpecialization || '').toLowerCase();
    const disciplineInput = (state.undergraduateDiscipline || '').toLowerCase();
    const goalInput = (state.graduateGoal || '').toLowerCase();
    const fieldMapping = [
      { keys: ['data science', 'artificial intelligence', 'ai', 'machine learning'], label: 'Data Science & AI' },
      { keys: ['business analytics'], label: 'Business Analytics' },
      { keys: ['finance', 'bank', 'economics', 'accounting'], label: 'Finance & Economics' },
      { keys: ['engineering', 'systems', 'mechanical', 'electrical', 'civil', 'chemical'], label: 'Engineering Systems' },
      { keys: ['health', 'biomedical', 'medical', 'pharma', 'clinical'], label: 'Biomedical' },
      { keys: ['public policy', 'policy', 'development', 'governance'], label: 'Policy & Development' },
      { keys: ['management', 'strategy', 'business'], label: 'Management' },
      { keys: ['interdisciplinary', 'analytics'], label: 'Interdisciplinary Research' },
    ];
    let fieldLabel = 'Graduate Research';
    const candidateText = `${specializationInput} ${disciplineInput} ${goalInput}`.trim();
    for (const item of fieldMapping) {
      if (item.keys.some(key => candidateText.includes(key))) { fieldLabel = item.label; break; }
    }
    if (fieldLabel === 'Graduate Research' && researchAnalysis.topField) {
      const fieldName = researchAnalysis.topField.charAt(0).toUpperCase() + researchAnalysis.topField.slice(1);
      fieldLabel = fieldName;
    }
    if (fieldLabel === 'Graduate Research' && researchAnalysis.matchedKeywords.length > 0) {
      fieldLabel = researchAnalysis.matchedKeywords[0];
    }
    const prefix = goalInput.includes('phd') ? 'Doctoral' : goalInput.includes("master") ? "MSc" : goalInput.includes('career') || goalInput.includes('advancement') ? 'Applied' : 'Advanced';
    primary = `${prefix} ${fieldLabel} Pathway`;
    primaryKey = fieldLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    alternative = fieldLabel.includes('Research') || fieldLabel === 'Interdisciplinary Research' ? `Applied ${fieldLabel} Pathway` : `Research & Career Pathway in ${fieldLabel}`;
    scores = {};
  }
  return { primary, alternative, scores, primaryKey };
}

function calculateReadiness(state){
  const stage = state.academicStage;
  const scoringProfile = getScoringProfile(state);
  const weights = { academic: 0.35, experience: 0.25, career: 0.15, admission: 0.15, financial: 0.10 };
  const componentScores = { academic: scoringProfile.componentBaselines.academic, experience: scoringProfile.componentBaselines.experience, career: scoringProfile.componentBaselines.career, admission: scoringProfile.componentBaselines.admission, financial: scoringProfile.componentBaselines.financial };
  const academicSignals = [];
  const normalizedCGPA = normalizeCGPAto100(state.cgpa);
  if(normalizedCGPA !== null) academicSignals.push(normalizedCGPA);
  if(state.subjects){
    const parsed = parseSubjects(state.subjects);
    if(parsed.length > 0){ const average = parsed.reduce((a,b)=>a+b.score,0) / parsed.length; academicSignals.push(average); }
  }
  if(stage === "Graduate" && state.courseworkHistory){
    const courses = parseCoursework(state.courseworkHistory);
    if(courses.length > 0){ const avgCourseScore = courses.reduce((a,b)=>a+b.score,0) / courses.length; academicSignals.push(avgCourseScore); }
  }
  if(academicSignals.length > 0){ componentScores.academic = clamp( academicSignals.reduce((a,b)=>a+b,0) / academicSignals.length, 0, 100 ); }
  if(stage === "Graduate" && state.academicAchievements && state.academicAchievements.length > 20){ componentScores.academic = clamp(componentScores.academic + 5, 0, 100); }
  let experienceScore = 0;
  if(stage === "Graduate"){
    const researchAnalysis = analyzeResearchProfile(state);
    if(state.publicationCount){
      if(state.publicationCount.includes("More than 5")) experienceScore += 34; else if(state.publicationCount.includes("3 - 5")) experienceScore += 28; else if(state.publicationCount.includes("1 - 2")) experienceScore += 18; else experienceScore += 4;
    }
    if(state.firstAuthor){
      if(state.firstAuthor.includes("multiple")) experienceScore += 20; else if(state.firstAuthor.includes("at least")) experienceScore += 14; else if(state.firstAuthor.includes("co-author")) experienceScore += 7;
    }
    if(state.manuscriptsInPrep){
      if(state.manuscriptsInPrep.includes("draft")) experienceScore += 14; else if(state.manuscriptsInPrep.includes("data analysis")) experienceScore += 9; else if(state.manuscriptsInPrep.includes("Planned")) experienceScore += 5;
    }
    if(state.thesisExperience){
      if(state.thesisExperience.includes("extensive")) experienceScore += 18; else if(state.thesisExperience.includes("moderate")) experienceScore += 12; else if(state.thesisExperience.includes("Minimal")) experienceScore += 6;
    }
    if(state.technicalSkills){
      if(state.technicalSkills.includes("Programming") || state.technicalSkills.includes("Data Analysis")) experienceScore += 14; else if(state.technicalSkills.includes("Lab") || state.technicalSkills.includes("Engineering")) experienceScore += 12; else if(state.technicalSkills.includes("Statistical") || state.technicalSkills.includes("Qualitative")) experienceScore += 8;
    }
    experienceScore += clamp((researchAnalysis.keywordCount || 0) * 2, 0, 10);
    if(state.timeAvailability){ const availability = parseFloat(state.timeAvailability); if(!isNaN(availability)) experienceScore += clamp(availability / 5, 0, 10); }
  }
  if(stage === "Undergraduate"){
    if(state.internshipExperience){
      if(state.internshipExperience.includes("substantial")) experienceScore += 45; else if(state.internshipExperience.includes("limited")) experienceScore += 30; else if(state.internshipExperience.includes("seeking")) experienceScore += 18; else experienceScore += 8;
    }
    if(state.specialization) experienceScore += 15;
    if(state.support && state.support.includes("Research")) experienceScore += 8;
  }
  if(stage === "Secondary School"){
    if(state.extracurricularStrength){
      if(state.extracurricularStrength.includes("No major")) experienceScore += 8; else if(state.extracurricularStrength.includes("Leadership") || state.extracurricularStrength.includes("competitions")) experienceScore += 35; else experienceScore += 24;
    }
    if(state.learningStyle) experienceScore += 10;
  }
  componentScores.experience = clamp(experienceScore, 0, 100);
  let careerScore = scoringProfile.componentBaselines.career;
  if(state.careerCertainty){
    if(state.careerCertainty.includes("Very")) careerScore += 45; else if(state.careerCertainty.includes("Moderately")) careerScore += 30; else if(state.careerCertainty.includes("Still")) careerScore += 15; else careerScore += 8;
  }
  if(stage === "Secondary School"){ if(state.career && !state.career.includes("Undecided")) careerScore += 20; }
  if(stage === "Graduate" && state.careerGoal){ careerScore += 15; }
  componentScores.career = clamp(careerScore, 0, 100);
  let admissionScore = scoringProfile.componentBaselines.admission;
  if(state.admissionConfidence){
    if(state.admissionConfidence.includes("Very")) admissionScore += 45; else if(state.admissionConfidence.includes("Somewhat")) admissionScore += 30; else if(state.admissionConfidence.includes("Unsure")) admissionScore += 15; else admissionScore += 8;
  }
  if(stage === "Graduate" && state.advisorPreference){
    if(state.advisorPreference.includes("specific supervisor")) admissionScore += 20; else if(state.advisorPreference.includes("Research area")) admissionScore += 12; else admissionScore += 6;
  }
  componentScores.admission = clamp(admissionScore, 0, 100);
  let financialScore = scoringProfile.componentBaselines.financial + 5;
  if(stage === "Secondary School" && state.financialConstraint){
    if(state.financialConstraint.includes("not a major")) financialScore = 90; else if(state.financialConstraint.includes("moderate")) financialScore = 72; else if(state.financialConstraint.includes("partial")) financialScore = 55; else financialScore = 40;
  }
  if(stage === "Graduate" && state.funding){
    if(state.funding.includes("not required")) financialScore = 90; else if(state.funding.includes("self-fund partially")) financialScore = 72; else if(state.funding.includes("partial")) financialScore = 58; else financialScore = 42;
  }
  componentScores.financial = clamp(financialScore, 0, 100);
  const weightedPercent = ( componentScores.academic * weights.academic + componentScores.experience * weights.experience + componentScores.career * weights.career + componentScores.admission * weights.admission + componentScores.financial * weights.financial );
  const completeness = computeReadinessCoverage(state);
  const strictnessMultiplier = clamp( scoringProfile.strictnessMin + (completeness * (1 - scoringProfile.strictnessMin)), scoringProfile.strictnessMin, 1 );
  const adjustedPercent = weightedPercent * strictnessMultiplier;
  const finalScore = clamp((adjustedPercent / 100) * 20, 1, 20);
  let label = "";
  if(finalScore >= scoringProfile.thresholds.high) label = "High Readiness";
  else if(finalScore >= scoringProfile.thresholds.moderate) label = "Moderate Readiness";
  else if(finalScore >= scoringProfile.thresholds.developing) label = "Developing Readiness";
  else label = "Needs Significant Improvement";
  return { score: Math.round(finalScore), label, componentScores, weightedPercent: Math.round(weightedPercent), adjustedPercent: Math.round(adjustedPercent), completeness: Math.round(completeness * 100), strictnessMultiplier, scoringMode: scoringProfile.mode, thresholds: scoringProfile.thresholds };
}

function generateStrengths(state){
  const strengths = [];
  const stage = state.academicStage;
  if(state.subjects){
    const parsed = parseSubjects(state.subjects);
    const topSubjects = parsed.filter(s => s.score >= 75);
    const avgScore = parsed.reduce((a,b)=>a+b.score,0) / parsed.length;
    if(avgScore >= 85){ strengths.push("An exceptional academic performance across core subjects"); }
    else if(topSubjects.length >= 3){ strengths.push(`strong performance in ${topSubjects.length} key subjects (avg: ${Math.round(avgScore)}%)`); }
  }
  if (stage === "Graduate") {
    if (state.courseworkHistory) {
      const courses = parseCoursework(state.courseworkHistory);
      const highPerforming = courses.filter(c => c.score >= 90);
      if (highPerforming.length >= 2) { strengths.push(`excellent performance in advanced coursework (${highPerforming.map(c => c.course).slice(0,2).join(', ')})`); }
    }
  }
  if (stage === "Graduate") {
    const researchAnalysis = analyzeResearchProfile(state);
    if (researchAnalysis.keywordCount >= 1) {
      const topSkills = researchAnalysis.matchedKeywords.slice(0, 3).join(', ');
      strengths.push(`demonstrated technical focus in ${topSkills}`);
    }
    if(state.cgpa) {
      let cgpaVal = parseFloat(state.cgpa);
      if (cgpaVal > 5.0) cgpaVal = (cgpaVal / 20) * 5.0;
      if (cgpaVal >= 3.5) { strengths.push(`strong academic performance (CGPA: ${state.cgpa})`); }
    }
    if(state.publicationCount && !state.publicationCount.includes('None')){ strengths.push(`an emerging research profile with ${state.publicationCount}`); }
    if(state.firstAuthor && state.firstAuthor.toLowerCase().includes('yes')){ strengths.push('first-author contributions'); }
    if(state.manuscriptsInPrep){
      if(state.manuscriptsInPrep.includes("draft ready")){ strengths.push('a proactive research pipeline with manuscripts nearing submission'); }
      else if (state.manuscriptsInPrep.includes("data analysis underway")){ strengths.push('ongoing research activity with data analysis in progress'); }
    }
    if(state.technicalSkills && !state.technicalSkills.includes('None')){ strengths.push(`primary technical expertise in ${state.technicalSkills}`); }
  }
  if(state.internshipExperience && state.academicStage === "Undergraduate"){
    if(state.internshipExperience.includes("substantial")){ strengths.push("strong industry experience that positions you competitively"); }
    else if(state.internshipExperience.includes("limited")){ strengths.push("emerging practical industry experience"); }
  }
  if(state.careerCertainty && state.careerCertainty.includes("Very")){ strengths.push("a clear and aligned career trajectory with defined objectives"); }
  if(state.academicStage === "Graduate" && state.publicationCount){
    if(state.publicationCount.includes("More than 5")){ strengths.push("a robust publication record demonstrating research credibility"); }
    else if(state.publicationCount.includes("3")){ strengths.push("an established academic publication presence"); }
  }
  if(state.admissionConfidence && state.admissionConfidence.includes("Very")){ strengths.push("high self-assessed admission readiness and preparedness"); }
  if((state.funding || state.financialConstraint) && ((state.funding && state.funding.includes("not required")) || (state.financialConstraint && state.financialConstraint.includes("not a major")) || (state.financialConstraint && state.financialConstraint.includes("moderate")))){ strengths.push("Financial capacity that provides stability for focused academic commitment"); }
  if(state.academicStage === "Secondary School" && state.extracurricularStrength && !state.extracurricularStrength.includes("No major")){
    if(state.extracurricularStrength.includes("Leadership") || state.extracurricularStrength.includes("competitions")){ strengths.push("Strong extracurricular engagement demonstrating leadership initiative"); }
  }
  return strengths;
}

function generateRiskFactors(state){
  const risks = [];
  const stage = state.academicStage;
  if(state.cgpa){
    let cgpaVal = parseFloat(state.cgpa);
    if (cgpaVal > 5.0) cgpaVal = (cgpaVal / 20) * 5.0;
    if(cgpaVal < 3.0){ risks.push(`an academic record (CGPA: ${state.cgpa}) that requires strategic strengthening for competitive programs`); }
  }
  if(state.subjects){
    const parsed = parseSubjects(state.subjects);
    const critical = parsed.filter(s => s.score < 50);
    const weak = parsed.filter(s => s.score < 60);
    if(critical.length >= 1){ risks.push(`critical gaps in ${critical.map(s => s.subject).join(", ")}`); }
    else if(weak.length >= 2){ risks.push(`inconsistent performance in ${weak.length} subjects`); }
  }
  if(state.careerCertainty){
    if(state.careerCertainty.includes("Completely") || state.careerCertainty.includes("unsure")){ risks.push("an undefined career trajectory"); }
  }
  if(state.academicStage === "Secondary School" && state.career && state.career.includes("Undecided")){ risks.push("early-stage career exploration"); }
  if(state.academicStage === "Undergraduate" || state.academicStage === "Graduate"){
    if(state.internshipExperience && state.internshipExperience.includes("No experience yet")){ risks.push("an absence of practical experience"); }
  }
  if(stage === "Graduate"){
    if(state.publicationCount && state.publicationCount.includes("None")){ risks.push("a lack of a publication record"); }
    if(!state.advisorPreference || state.advisorPreference.includes("Still exploring")){ risks.push("pending advisor/supervisor identification"); }
    const specialization = (state.targetSpecialization || '').toLowerCase();
    const researchInterest = (state.researchInterest || '').toLowerCase();
    if(specialization && specialization.includes('finance') && researchInterest && !researchInterest.includes('finance') && !researchInterest.includes('economics')){ risks.push("an unclear research direction relative to your finance specialization"); }
  }
  if(stage === "Secondary School" && state.financialConstraint && state.financialConstraint.includes("Require full")){ risks.push("a dependency on a full scholarship"); }
  if(stage === "Graduate" && state.funding && state.funding.includes("Require full")){ risks.push("a full funding requirement"); }
  if(state.admissionConfidence && (state.admissionConfidence.includes("Unsure") || state.admissionConfidence.includes("significant"))){ risks.push("expressed admission uncertainty"); }
  return risks;
}

function calculateInferenceConfidence(state){
  let confidence = 45;
  const stage = state.academicStage;
  if(state.subjects) { confidence += 12; }
  if(state.cgpa) { confidence += 12; }
  if(state.career) { confidence += 10; }
  if(state.learningStyle) { confidence += 8; }
  if(stage === "Graduate"){
    if(state.targetSpecialization) { confidence += 10; }
    if(state.publicationCount) { confidence += 8; }
    if(state.advisorPreference) { confidence += 7; }
    if(state.firstAuthor) { confidence += 5; }
  }
  if(stage === "Undergraduate"){
    if(state.internshipExperience) { confidence += 10; }
    if(state.specialization) { confidence += 8; }
  }
  if(stage === "Secondary School"){
    if(state.extracurricularStrength) { confidence += 8; }
    if(state.studyDestination) { confidence += 6; }
  }
  return Math.min(confidence, 99);
}

function generateNarrativeSummary(state, pathway, readiness, strengths, risks){
  const stage = state.academicStage;
  let summary = "";
  const stageRoleMap = { "Secondary School": "learner", "Undergraduate": "student", "Graduate": "candidate" };
  const stageRole = stageRoleMap[stage] || "student";
  const article = /^[aeiou]/i.test(stage) ? "an" : "a";
  summary += `<p>Based on your profile as ${article} <strong>${stage} ${stageRole}</strong>, this analysis provides a personalized assessment of your academic pathway and readiness for your next decision point.</p>`;
  const profileSignals = buildProfileSignals(state);
  if(profileSignals.length > 0){ summary += `<p><strong class="summary-title">Personalized Profile Signals:</strong> Your current responses highlight ${formatList(profileSignals)}. These signals were prioritized when generating the pathway and readiness recommendations below.</p>`; }
  let pathwayText;
  if (pathway.primary.startsWith("MSc")) { pathwayText = `a <strong>Master's programme in ${pathway.primary.replace('MSc ', '').replace(' Pathway', '')}</strong>`; }
  else if (pathway.primary.startsWith("Doctoral")) { pathwayText = `a <strong>Doctoral programme in ${pathway.primary.replace('Doctoral ', '').replace(' Pathway', '')}</strong>`; }
  else {
    const simpleFields = ["Engineering", "Medicine / Health Sciences", "Computing", "Business", "Arts"];
    if (simpleFields.includes(pathway.primary)) { pathwayText = `<strong>${pathway.primary}</strong>`; }
    else { pathwayText = `the <strong>${pathway.primary}</strong>`; }
  }
  let pathwayIntro = `<p><strong class="summary-title">Pathway Analysis:</strong> Your inputs suggest an optimal alignment with ${pathwayText}. `;
  if (stage === "Secondary School" && state.subjects) {
    const parsedSubjects = parseSubjects(state.subjects);
    const relevantSubjectsMap = { engineering: ["math", "physics", "further math", "technical drawing"], medicine: ["biology", "chemistry", "physics"], computing: ["computer", "ict", "math", "physics"], business: ["economics", "commerce", "accounting", "business studies"], arts: ["literature", "government", "history", "art", "music"], };
    const pathwayKey = pathway.primaryKey;
    const relevantKeywords = relevantSubjectsMap[pathwayKey] || [];
    let relevantTopSubjects = [];
    if (relevantKeywords.length > 0 && parsedSubjects.length > 0) {
        relevantTopSubjects = parsedSubjects.filter(s => relevantKeywords.some(keyword => s.subject.includes(keyword))).sort((a, b) => b.score - a.score).slice(0, 3);
    }
    if (relevantTopSubjects.length > 0) {
        const subjectNames = relevantTopSubjects.map(s => `<strong>${s.subject.charAt(0).toUpperCase() + s.subject.slice(1)}</strong>`);
        let subjectText;
        if (subjectNames.length === 1) { subjectText = subjectNames[0]; }
        else if (subjectNames.length === 2) { subjectText = subjectNames.join(' and '); }
        else { const last = subjectNames.pop(); subjectText = `${subjectNames.join(', ')}, and ${last}`; }
        const verb = relevantTopSubjects.length > 1 ? 'are key indicators' : 'is a key indicator';
        pathwayIntro += `Your high performance in ${subjectText} ${verb} for this path.`;
    } else { pathwayIntro += `This is based on an analysis of your academic strengths and interests.`; }
  } else if (stage === "Graduate") {
    const specialization = state.targetSpecialization || 'your chosen field';
    const background = state.undergraduateDiscipline || 'your undergraduate background';
    const techSkill = state.technicalSkills || 'none';
    let narrative = `Your profile presents an interesting intersection between <strong>${background}</strong> and a desired focus on <strong>${specialization}</strong>. `;
    const isBusinessBg = /business|marketing|economic|finance|management|accounting/.test(background.toLowerCase());
    const hasQuantSkill = /programming|data analysis|statistical|matlab|spss|stata/.test(techSkill.toLowerCase());
    const isDataPathway = /data science|analytics|computing|a\.?i\.?/.test(pathway.primary.toLowerCase());
    if (isBusinessBg && hasQuantSkill && isDataPathway) { narrative += `Your expertise in <strong>${techSkill}</strong> provides a crucial bridge, suggesting a strong aptitude for quantitative analysis within a business context. This makes the recommendation of ${pathwayText} a logical and powerful next step. This program will build upon your existing statistical skills, equipping you with advanced computational techniques to translate data into actionable business strategy.`; }
    else if (isDataPathway) { narrative += `The recommended pathway, ${pathwayText}, aligns with the growing demand for data-driven expertise. It represents a strategic move to build a highly sought-after computational skillset that complements your background in <strong>${background}</strong>.`; }
    else { narrative += `The recommended pathway, ${pathwayText}, is a direct reflection of your stated interests and academic signals, providing a clear route towards your graduate goals.`; }
    pathwayIntro = `<p><strong class="summary-title">Pathway Analysis:</strong> ${narrative}`;
  } else if (stage === "Undergraduate" && state.specialization) { pathwayIntro += `Your stated interest in "${state.specialization}" is a primary driver for this recommendation, which focuses on advanced skill acquisition.`; }
  if (pathway.alternative) { pathwayIntro += ` An alternative to explore that still aligns with your profile is <strong>${pathway.alternative}</strong>.`; }
  pathwayIntro += `</p>`;
  summary += pathwayIntro;
  const readinessContext = { "High Readiness": "Comprehensive preparation across academic and practical dimensions positions you for immediate competitive pursuit.", "Moderate Readiness": "Solid foundation exists; targeted intervention on identified gaps will enhance competitive positioning.", "Developing Readiness": "Emerging foundation requires continued development and strategic support to enhance competitive positioning.", "Needs Significant Improvement": "Structured support plan required to develop competitive academic profile." };
  summary += `<p><strong class="summary-title">Readiness Deep Dive (${readiness.score}/20):</strong> Your current profile is assessed as <strong>${readiness.label}</strong>. ${readinessContext[readiness.label]} `;
  const { componentScores } = readiness;
  const positives = [];
  const negatives = [];
  if (componentScores.academic >= 70) positives.push('strong academic performance'); else if (componentScores.academic < 45) negatives.push('improve academic performance');
  if (componentScores.experience >= 65) { positives.push(stage === "Secondary School" ? 'meaningful practical exposure and extracurricular engagement' : 'meaningful research or practical experience'); } else if (componentScores.experience < 40) { negatives.push(stage === "Secondary School" ? 'build more pathway-relevant practical exposure' : 'build more hands-on research experience'); }
  if (componentScores.career >= 65) positives.push('clear career direction'); else if (componentScores.career < 40) negatives.push('clarify career goals and focus');
  const evidence = [];
  if(state.cgpa) evidence.push(`CGPA: ${state.cgpa}`);
  if(state.publicationCount && !state.publicationCount.includes('None')) evidence.push(`Publications: ${state.publicationCount}`);
  if(state.firstAuthor) evidence.push(`first-author: ${state.firstAuthor}`);
  if(state.manuscriptsInPrep) evidence.push(`manuscripts: ${state.manuscriptsInPrep}`);
  if(state.timeAvailability) evidence.push(`time availability: ${state.timeAvailability}%`);
  if(positives.length > 0) summary += `<br><strong>Strength signals:</strong> ${positives.join(', ')}.`;
  if(negatives.length > 0) summary += ` <strong>Areas to improve:</strong> ${negatives.join(', ')}.`;
  if(evidence.length > 0) summary += ` <br><strong>Evidence:</strong> ${evidence.join('; ')}.`;
  if(readiness.completeness !== undefined){ summary += ` <br><strong>Scoring strictness:</strong> ${readiness.completeness}% profile completeness with a strictness factor of ${readiness.strictnessMultiplier.toFixed(2)}.`; }
  summary += `</p>`;
  if (strengths.length > 0) { const listed = strengths.map(s => `<li>${s}</li>`).join(''); summary += `<p><strong class="summary-title">Key Competitive Advantages:</strong></p><ul>${listed}</ul>`; }
  if (risks.length > 0) {
    const isSingleOpportunity = risks.length === 1;
    const opportunityTerm = risks.length > 1 ? "several key areas for growth" : "a key area for growth";
    const opportunityHeading = isSingleOpportunity ? "Strategic Development Opportunity" : "Strategic Development Opportunities";
    const focusSentence = isSingleOpportunity ? "Focusing on this area will substantially boost your competitiveness." : "Focusing on these areas will substantially boost your competitiveness.";
    const cleanedRisks = risks.map(r => withoutTerminalPunctuation(r));
    let formattedRisks;
    if (cleanedRisks.length === 1) { formattedRisks = `<em>${cleanedRisks[0]}</em>`; }
    else if (cleanedRisks.length === 2) { formattedRisks = `<em>${cleanedRisks[0]}</em> and <em>${cleanedRisks[1]}</em>`; }
    else { formattedRisks = cleanedRisks.slice(0, cleanedRisks.length - 1).map(r => `<em>${r}</em>`).join(', ') + `, and <em>${cleanedRisks[cleanedRisks.length - 1]}</em>`; }
    summary += `<p><strong class="summary-title">${opportunityHeading}:</strong> To maximize your potential, we've identified ${opportunityTerm}: ${formattedRisks}. ${focusSentence}</p>`;
  }
  let trajectory = `<p><strong class="summary-title">Your Personalized Trajectory:</strong> `;
  if (stage === "Secondary School") { trajectory += `For a secondary-school learner, your immediate goal is to build a coherent profile that connects your academic outcomes with activities aligned to <strong>${pathway.primary}</strong>. Prioritize subject mastery, admission planning, and practical exposure relevant to your target course area.`; }
  else if (stage === "Undergraduate") { trajectory += `At this crucial development stage, your focus should be on translating academic knowledge into practical skills. Actively seek internships and projects related to the <strong>${pathway.primary}</strong> to build a competitive portfolio for either industry employment or graduate studies.`; }
  else if (stage === "Graduate") {
    let trajectoryFocus = "deepening your research footprint by publishing your work and strategically networking with potential supervisors";
    if (risks.length > 0) {
        if (risks[0].includes("publication")) { trajectoryFocus = "securing your first peer-reviewed publication, as this is a critical step to becoming a competitive candidate"; }
        else if (risks[0].includes("advisor") || risks[0].includes("supervisor")) { trajectoryFocus = "strategically identifying and contacting potential supervisors, as a strong alignment is key to a successful graduate journey"; }
        else if (risks[0].includes("GPA")) { trajectoryFocus = `strengthening your academic record. For a quantitative field like <strong>${pathway.primary.replace('MSc ', '').replace(' Pathway', '')}</strong>, consider certified courses in foundational mathematics (e.g., Linear Algebra, Calculus) and advanced statistics to demonstrate your quantitative readiness. A pre-master's program is also an excellent option`; }
    } else if (strengths.length > 0) {
        if (strengths[0].includes("publication")) { trajectoryFocus = "leveraging your strong publication record to attract top-tier supervisors and secure competitive funding"; }
        else if (strengths[0].includes("research portfolio")) { trajectoryFocus = "refining your extensive research into publishable articles and presenting at conferences to build your academic network"; }
    }
    trajectory += `Your path towards a successful graduate career in <strong>${pathway.primary}</strong> depends on ${trajectoryFocus}.`;
  }
  trajectory += `</p>`;
  summary += trajectory;
  return summary;
}

function generateResources(state){
  const resources = [];
  resources.push('<a href="https://adaptroute.com/guide-2-managing-academic-workload/" target="_blank" rel="noopener noreferrer">Academic counseling sessions</a>');
  resources.push("Scholarship application guidance");
  resources.push("Career development workshops");
  if(state.academicStage === "Graduate"){
    resources.push('<a href="https://adaptroute.com/research-superviosr-matching/" target="_blank" rel="noopener noreferrer">Research supervisor matching</a>');
  }
  return resources;
}

function generateRecommendations(state, pathway){
  const recommendations = [];
  const stage = state.academicStage;
  if(stage === "Secondary School"){
    recommendations.push(`Target universities with strong ${pathway} programs and review admission requirements plus prerequisite subjects.`);
    if(state.admissionConfidence && state.admissionConfidence.includes("Need significant")){ recommendations.push("Engage with secondary education advisors for university selection and application strategy."); }
  } else if(stage === "Undergraduate"){
    recommendations.push(`Pursue specialized coursework and electives that deepen ${pathway} competency.`);
    if(state.transferIntent && state.transferIntent.includes("transfer")){ recommendations.push("Develop detailed academic transfer strategy addressing target institution requirements."); }
  } else if(stage === "Graduate"){
    recommendations.push(`Identify and connect with research groups in ${pathway}—send inquiry emails to potential supervisors.`);
    if(state.publicationCount && state.publicationCount.includes("None")){ recommendations.push("Prioritize publication strategy: submit current research findings to peer-reviewed venues."); }
  }
  const needsFunding = (stage === "Secondary School" && state.financialConstraint && !state.financialConstraint.includes("not a major") && !state.financialConstraint.includes("moderate")) || (stage === "Undergraduate" && state.financialConstraint && state.financialConstraint.includes("partial")) || (stage === "Undergraduate" && state.support && state.support.includes("Scholarship")) || (stage === "Graduate" && state.funding && state.funding.includes("require"));
  if(needsFunding){ recommendations.push("Systematically research scholarship databases—identify external funding aligned with your profile and pathway."); }
  if(stage === "Undergraduate"){
    if(state.internshipExperience && state.internshipExperience.includes("No experience yet")){ recommendations.push("Secure internship placement before graduation—prioritize positions in pathway-aligned organizations."); }
  } else if(stage === "Graduate"){
    if(state.advisorPreference && state.advisorPreference.includes("Still exploring")){ recommendations.push("Research and identify 3-5 potential thesis advisors—initiate exploratory conversations with research groups."); }
  }
  if(state.subjects){
    const parsed = parseSubjects(state.subjects);
    const weak = parsed.filter(s => s.score < 60);
    if(weak.length > 0){ recommendations.push(`Focus remedial effort on ${weak.map(s => s.subject).join(" and ")}—these directly impact competitiveness.`); }
  }
  if(stage === "Secondary School"){
    if(state.extracurricularStrength && state.extracurricularStrength.includes("No major")){ recommendations.push("Initiate strategic extracurricular participation—science clubs or tech competitions strengthen profile."); }
  }
  return recommendations;
}

// --- MAIN ORCHESTRATOR ---

/**
 * The main exported function that orchestrates the entire analysis.
 * It takes the user's state as input and returns the complete profile object.
 * @param {object} state - The user's input state from the frontend.
 * @returns {object} The complete, calculated profile.
 */
function runAnalysis(state) {
  const stage = state.academicStage;

  const pathwayResult = inferPathway(state);

  let researchAnalysis = null;
  if (stage === 'Graduate') {
    researchAnalysis = analyzeResearchProfile(state);
  }

  // Add parsed subjects for dashboard chart
  let parsedSubjectsData = null;
  if (stage === 'Secondary School' && state.subjects) {
    parsedSubjectsData = parseSubjects(state.subjects);
  }

  const readiness = calculateReadiness(state);
  const strengths = normalizeStatements(generateStrengths(state));
  const risks = normalizeStatements(generateRiskFactors(state));
  const recommendations = enforceStageRecommendationGuardrails(
    stage,
    normalizeStatements(generateRecommendations(state, pathwayResult.primary))
  );
  const resources = generateResources(state);
  const confidence = calculateInferenceConfidence(state);
  const confidenceDrivers = buildConfidenceExplanation(state);

  const profile = {
    state: { ...state },
    userType: stage,
    primaryPathway: pathwayResult.primary,
    alternativePathway: pathwayResult.alternative,
    primaryPathwayKey: pathwayResult.primaryKey,
    pathwayScores: pathwayResult.scores,
    researchAnalysis,
    readiness,
    scoringMode: state.scoringMode,
    strengths,
    risks,
    recommendations,
    resources,
    confidence,
    confidenceDrivers,
    parsedSubjects: parsedSubjectsData,
    summary: generateNarrativeSummary(
      state,
      pathwayResult,
      readiness,
      strengths,
      risks
    )
  };

  return profile;
}

module.exports = { runAnalysis };
