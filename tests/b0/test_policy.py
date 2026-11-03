"""No service/DB access: validate decisions and timing thresholds before smoke."""
import importlib.util,pathlib,unittest
path=pathlib.Path(__file__).resolve().parents[2]/'tools/b0/lab.py'
spec=importlib.util.spec_from_file_location('b0lab',path);lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
class PolicyTests(unittest.TestCase):
 def state(self,p,t,**override):
  fields=dict(memory_available=4*1024**3,memory_ratios=[.1],backlog=99441,progress=(0,0));fields.update(override);return p.evaluate(t,**fields)
 def test_old_queue_alone_is_not_stop(self):
  p=lab.Policy()
  for t in range(0,1000,10):self.assertEqual(self.state(p,t,progress=(t,t)), 'CONTINUE')
 def test_stall_and_memory_stop_supply_not_force_kill(self):
  p=lab.Policy();self.assertEqual(self.state(p,0),'CONTINUE');self.assertEqual(self.state(p,60),'STOP_SUPPLY')
  p=lab.Policy();self.assertEqual(self.state(p,0,memory_available=1),'CONTINUE');self.assertEqual(self.state(p,20,memory_available=1),'STOP_SUPPLY')
  p=lab.Policy();self.assertEqual(self.state(p,0,memory_ratios=[.81]),'CONTINUE');self.assertEqual(self.state(p,30,memory_ratios=[.81]),'STOP_SUPPLY')
 def test_integrity_oom_io_stop_now(self):
  for fields in [dict(integrity=False),dict(oom=True),dict(io_error=True)]:self.assertEqual(self.state(lab.Policy(),0,**fields),'STOP_NOW')
class LifecycleTests(unittest.TestCase):
 def test_supply_stop_once_then_bounded_drain(self):
  c=lab.Lifecycle(100,20)
  self.assertEqual(c.step(5,'STOP_SUPPLY',False,False,False,'a'),'STOP_SUPPLY')
  self.assertEqual(c.step(10,'STOP_SUPPLY',False,False,True,'b'),'OBSERVE')
  self.assertEqual(c.step(25,'CONTINUE',False,False,True,'c'),'DRAIN_TIMEOUT')
 def test_initial_empty_is_not_success_and_three_complete_samples(self):
  c=lab.Lifecycle(100,20)
  self.assertEqual(c.step(1,'CONTINUE',False,False,True,'initial'),'OBSERVE')
  for t in [5,10]:self.assertEqual(c.step(t,'CONTINUE',True,True,True,str(t)),'OBSERVE')
  self.assertEqual(c.step(15,'CONTINUE',True,True,True,'15'),'DRAIN_COMPLETE');self.assertEqual(c.first_zero,'5')
 def test_immediate_stop_is_distinct_from_supply_stop(self):
  self.assertEqual(lab.Lifecycle(100,20).step(2,'STOP_NOW',False,False,False,'a'),'STOP_NOW')
if __name__=='__main__':unittest.main()
