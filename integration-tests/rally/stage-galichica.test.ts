import { galichicaMap } from '../../src/games/rally/maps/galichica/map';
import { describeStages } from './stage-harness';

// Not galichica_east: it is the first half of prespa_ohrid (same start, same direction), which drives it to the pass.
// Raw surfaces: on the recommended tarmac tyres in the stage climate some cars stall on the cold Prespa side.
describeStages(galichicaMap, ['galichica_west', 'prespa_ohrid'], {
  climate: false,
});
