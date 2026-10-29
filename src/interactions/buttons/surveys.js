import { handleSurveyAdminButton, handleSurveyButton } from '../../handlers/surveys.js';

export default [
    { name: 'survey_admin', execute: handleSurveyAdminButton },
    { name: 'survey_submit', execute: handleSurveyButton },
];
