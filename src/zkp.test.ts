import { Cache, ZkProgram } from "o1js";
import { Big } from "./bigint.js";
import { ClassGroup } from "./classgroup.js";

const Pow = ZkProgram({
  name: 'Pow',
  publicInput: ClassGroup,
  publicOutput: ClassGroup,

  methods: {
    pow: {
      privateInputs: [Big],
      async method(pub: ClassGroup, priv: Big): Promise<ClassGroup> {
        return pub.pow(priv);
      }
    }
  }
});

test("compile", async () => {
  await Pow.compile({ cache: Cache.None });
}, 60_000);
