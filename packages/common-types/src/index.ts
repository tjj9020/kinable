export interface SampleType {
  id: string;
  name: string;
}

export enum SampleEnum {
  Option1 = 'OPTION1',
  Option2 = 'OPTION2',
}

export * from './core-interfaces';
export * from './config-schema';
export * from './ai-interfaces'; 