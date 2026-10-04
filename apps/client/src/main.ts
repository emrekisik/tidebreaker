import { TICK_RATE } from '@tidebreaker/shared/config';

const app = document.getElementById('app');
if (app) app.textContent = `Tidebreaker.io (tick rate ${TICK_RATE} Hz)`;
