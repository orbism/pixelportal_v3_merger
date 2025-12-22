import { makeAutoObservable } from "mobx";

export enum SubmissionStatus {
  IDLE = "idle",
  SUBMITTING = "submitting",
  SUCCESS = "success",
  ERROR = "error",
}

class HelpStore {
  submissionStatus: SubmissionStatus = SubmissionStatus.IDLE;
  errorMessage: string = "";
  ticketId: number | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setSubmissionStatus(status: SubmissionStatus) {
    this.submissionStatus = status;
  }

  setErrorMessage(message: string) {
    this.errorMessage = message;
  }

  setTicketId(id: number) {
    this.ticketId = id;
  }

  reset() {
    this.submissionStatus = SubmissionStatus.IDLE;
    this.errorMessage = "";
    this.ticketId = null;
  }
}

export default HelpStore;

