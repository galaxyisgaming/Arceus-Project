import { handleOnboardingForm, handleOnboardingReview } from '../../handlers/onboarding.js';

export default [
    { name: 'onboarding_form', execute: handleOnboardingForm },
    { name: 'onboarding_review', execute: handleOnboardingReview },
];
