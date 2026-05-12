import axios from 'axios';

export const changeLossRange = data => axios.post('', data);
export const changeMaxDeletion = data => axios.post('', data);
