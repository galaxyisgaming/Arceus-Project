import { handleSurveyEdit, handleSurveyForm } from '../../handlers/surveys.js';

export default [
    { name: 'survey_edit', execute: handleSurveyEdit },
    { name: 'survey_form', execute: handleSurveyForm },
];
