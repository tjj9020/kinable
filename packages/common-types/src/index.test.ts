import { SampleType, SampleEnum } from './index';

describe('Common Types', () => {
  test('SampleType can be instantiated', () => {
    const sample: SampleType = {
      id: '123',
      name: 'Test'
    };
    
    expect(sample.id).toBe('123');
    expect(sample.name).toBe('Test');
  });

  test('SampleEnum has correct values', () => {
    expect(SampleEnum.Option1).toBe('OPTION1');
    expect(SampleEnum.Option2).toBe('OPTION2');
  });
}); 