#!/usr/bin/env python3
"""Time-safe CatBoost challenger training with automatic promotion gates and hybrid safety."""
from __future__ import annotations
import argparse,json,math,sqlite3,statistics
from datetime import date,datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from catboost import CatBoostClassifier,CatBoostRegressor

TZ=ZoneInfo("Europe/Berlin"); MIN_TRAIN_DAYS=14; MIN_PROMOTION_DAYS=28; VALIDATION_DAYS=7
FEATURES=["ride_id","category","minute_of_day","weekday","is_weekend","month","day_of_year","temperature_c","precipitation_mm","cloud_cover_percent","wind_speed_kmh","event_type","is_summer_nights","open_duration_minutes","minutes_since_open","minutes_until_close","is_public_holiday_nrw","is_school_holiday_nrw","is_school_holiday_nl","weather_sensitive","rain_weather_interaction","heat_weather_interaction","cold_weather_interaction"]
CAT=[0,1,11]
NRW_SCHOOL={2026:[("2026-03-30","2026-04-11"),("2026-07-20","2026-09-01"),("2026-10-17","2026-10-31"),("2026-12-23","2027-01-06")],2027:[("2027-03-22","2027-04-03"),("2027-07-19","2027-08-31"),("2027-10-23","2027-11-06"),("2027-12-24","2028-01-08")]}
NL_SCHOOL={2026:[("2026-02-14","2026-03-01"),("2026-04-25","2026-05-10"),("2026-07-04","2026-08-30"),("2026-10-10","2026-10-25"),("2026-12-19","2027-01-03")],2027:[("2027-02-13","2027-02-28"),("2027-04-24","2027-05-09"),("2027-07-10","2027-09-05"),("2027-10-16","2027-10-31"),("2027-12-25","2028-01-09")]}

def easter(year):
 a=year%19;b=year//100;c=year%100;d=b//4;e=b%4;f=(b+8)//25;g=(b-f+1)//3;h=(19*a+b-d-g+15)%30;i=c//4;k=c%4;l=(32+2*e+2*i-h-k)%7;m=(a+11*h+22*l)//451
 return date(year,(h+l-7*m+114)//31,(h+l-7*m+114)%31+1)
def holiday(day):
 e=easter(day.year);return int((day.month,day.day) in {(1,1),(5,1),(10,3),(11,1),(12,25),(12,26)} or day in {e-timedelta(days=2),e+timedelta(days=1),e+timedelta(days=39),e+timedelta(days=50),e+timedelta(days=60)})
def ranged(day,items):return int(any(a<=day.isoformat()<=b for a,b in items))
def event_type(value):
 value=(value or "").lower()
 return "summer-nights" if "summer" in value else "halloween" if "halloween" in value else "hollywood-christmas" if "christmas" in value or "weihnacht" in value else "other-event" if value.strip() else "none"
def nearest(values,q):
 ordered=sorted(values);return ordered[max(0,min(len(ordered)-1,math.ceil(q*len(ordered))-1))]

def rows(db,open_only=True):
 return db.execute("""SELECT t.ride_id,COALESCE(t.category,'unknown'),t.minute_of_day,t.weekday,t.is_weekend,
  CAST(substr(t.operating_date,6,2) AS INTEGER),CAST(strftime('%j',t.operating_date) AS INTEGER),
  COALESCE(t.temperature_c,15),COALESCE(t.precipitation_mm,0),COALESCE(t.cloud_cover_percent,50),COALESCE(t.wind_speed_kmh,10),
  t.wait_minutes,t.operating_date,t.status,c.opens_minute,c.closes_minute,c.event_name,COALESCE(t.weather_sensitive,0)
  FROM ride_training_rows t LEFT JOIN park_calendar c ON c.operating_date=t.operating_date
  WHERE (?=0 AND t.status IN ('open','closed')) OR (?=1 AND t.status='open' AND t.measurement_valid=1 AND t.wait_minutes IS NOT NULL)
  ORDER BY t.operating_date,t.observed_at""",(int(open_only),int(open_only))).fetchall()
def x(row):
 day=date.fromisoformat(row[12]);minute=int(row[2]);opens=int(row[14] or 600);closes=int(row[15] or 1080);temp=float(row[7]);rain=float(row[8]);sensitive=int(row[17] or 0);event=event_type(row[16])
 return [str(row[0]),str(row[1]),minute,int(row[3]),int(row[4]),int(row[5]),int(row[6]),temp,rain,float(row[9]),float(row[10]),event,int(event=="summer-nights"),max(0,closes-opens),max(0,minute-opens),max(0,closes-minute),holiday(day),ranged(day,NRW_SCHOOL.get(day.year,[])),ranged(day,NL_SCHOOL.get(day.year,[])),sensitive,rain*sensitive,max(0,temp-25)*sensitive,max(0,8-temp)*sensitive]
def baseline(train,test):
 by={}
 for r in train:by.setdefault((r[0],r[2]),[]).append(float(r[11]))
 all_values=[float(r[11]) for r in train];fallback=statistics.median(all_values)
 return [statistics.median(by.get((r[0],r[2]),all_values)) if all_values else fallback for r in test]
def mae(actual,pred):return sum(abs(a-b) for a,b in zip(actual,pred))/len(actual)
def main():
 p=argparse.ArgumentParser();p.add_argument("--database",type=Path,default=Path("data/moviepark.sqlite"));p.add_argument("--models",type=Path,default=Path("data/models"));a=p.parse_args()
 db=sqlite3.connect(a.database,timeout=60);db.execute("PRAGMA busy_timeout=60000");all_rows=rows(db);all_status_rows=rows(db,False);days=sorted({r[12] for r in all_rows});checked=datetime.now(TZ).isoformat()
 if len(days)<MIN_TRAIN_DAYS:
  metrics={"trainingDays":len(days),"requiredDays":MIN_TRAIN_DAYS,"promotionDays":MIN_PROMOTION_DAYS,"status":"waiting"}
  db.execute("INSERT OR REPLACE INTO model_registry VALUES(?,?,?,?,?,?,?,?)",(f"waiting-{days[-1] if days else 'none'}",checked,"catboost-multiquantile","waiting",len(days),json.dumps(metrics),None,None));db.commit();db.close();print(json.dumps(metrics));return 0
 validation=set(days[-VALIDATION_DAYS:]);train=[r for r in all_rows if r[12] not in validation];test=[r for r in all_rows if r[12] in validation]
 model=CatBoostRegressor(iterations=500,depth=7,learning_rate=.05,loss_function="MultiQuantile:alpha=0.1,0.5,0.9",verbose=False,random_seed=310,thread_count=2,allow_writing_files=False)
 model.fit([x(r) for r in train],[float(r[11]) for r in train],cat_features=CAT)
 prediction=model.predict([x(r) for r in test]);actual=[float(r[11]) for r in test];raw_p10=[float(v[0]) for v in prediction];p50=[float(v[1]) for v in prediction];raw_p90=[float(v[2]) for v in prediction];base_prediction=baseline(train,test);residuals=[y-p for y,p in zip(actual,p50)];global_calibration={"lowerOffset":round(nearest(residuals,.1),3),"upperOffset":round(nearest(residuals,.9),3)}
 per_ride={}
 for ride_id in sorted({r[0] for r in test}):
  indexes=[i for i,row in enumerate(test) if row[0]==ride_id]
  if len(indexes)<10:continue
  ride_actual=[actual[i] for i in indexes];ride_model=[p50[i] for i in indexes];ride_base=[base_prediction[i] for i in indexes]
  model_score=mae(ride_actual,ride_model);base_score=mae(ride_actual,ride_base)
  ride_residuals=[residuals[i] for i in indexes];calibration=global_calibration if len(indexes)<100 else {"lowerOffset":round(nearest(ride_residuals,.1),3),"upperOffset":round(nearest(ride_residuals,.9),3)};coverage=sum(max(0,p50[i]+calibration["lowerOffset"])<=actual[i]<=max(p50[i],p50[i]+calibration["upperOffset"]) for i in indexes)/len(indexes);strategy="model" if model_score<=base_score*1.05 else "baseline"
  per_ride[str(ride_id)]={"samples":len(indexes),"mae":round(model_score,3),"baselineMae":round(base_score,3),"biasMinutes":round(sum(p50[i]-actual[i] for i in indexes)/len(indexes),3),"intervalCoverage":round(coverage,4),"calibration":calibration,"strategy":strategy,"improved":strategy=="model"}
 ride_policy=[per_ride.get(str(row[0]),{"strategy":"baseline","calibration":global_calibration}) for row in test]
 hybrid=[p50[i] if ride_policy[i]["strategy"]=="model" else base_prediction[i] for i in range(len(test))];calibrated=[(max(0,p50[i]+ride_policy[i]["calibration"]["lowerOffset"]),max(p50[i],p50[i]+ride_policy[i]["calibration"]["upperOffset"])) for i in range(len(test))];model_mae=mae(actual,p50);hybrid_mae=mae(actual,hybrid);base_mae=mae(actual,base_prediction);improvement=(base_mae-hybrid_mae)/base_mae if base_mae else 0;coverage=sum(lo<=y<=hi for (lo,hi),y in zip(calibrated,actual))/len(actual);raw_coverage=sum(lo<=y<=hi for lo,y,hi in zip(raw_p10,actual,raw_p90))/len(actual);bias=sum(pred-y for pred,y in zip(hybrid,actual))/len(actual);stable_ride_share=sum(item["improved"] for item in per_ride.values())/len(per_ride) if per_ride else 0
 closure_train=[r for r in all_status_rows if r[12] not in validation];closure_test=[r for r in all_status_rows if r[12] in validation];closure=CatBoostClassifier(iterations=350,depth=6,learning_rate=.06,loss_function="Logloss",verbose=False,random_seed=311,thread_count=2,allow_writing_files=False);closure.fit([x(r) for r in closure_train],[int(r[13]=='open') for r in closure_train],cat_features=CAT);closure_probability=[float(value[1]) for value in closure.predict_proba([x(r) for r in closure_test])];closure_actual=[int(r[13]=='open') for r in closure_test];closure_accuracy=sum((p>=.5)==bool(y) for p,y in zip(closure_probability,closure_actual))/len(closure_actual);closure_brier=statistics.fmean((p-y)**2 for p,y in zip(closure_probability,closure_actual))
 model_ride_share=sum(item["strategy"]=="model" for item in per_ride.values())/len(per_ride) if per_ride else 0
 safe_ride_share=sum((item["mae"] if item["strategy"]=="model" else item["baselineMae"])<=item["baselineMae"]*1.05 for item in per_ride.values())/len(per_ride) if per_ride else 0
 fallback_ride_share=1-model_ride_share if per_ride else 0
 gate_passed=improvement>=.05 and .72<=coverage<=.88 and abs(bias)<=5 and safe_ride_share>=.95;promotion_eligible=len(days)>=MIN_PROMOTION_DAYS;passed=promotion_eligible and gate_passed;version=f"catboost-safe-hybrid-v3-{days[-1]}";a.models.mkdir(parents=True,exist_ok=True);artifact=a.models/f"{version}.cbm";closure_artifact=a.models/f"{version}-closure.cbm";model.save_model(artifact);closure.save_model(closure_artifact)
 metrics={"trainingDays":len(days),"minimumTrainingDays":MIN_TRAIN_DAYS,"minimumPromotionDays":MIN_PROMOTION_DAYS,"validationDays":sorted(validation),"split":"last-7-complete-operating-days","samples":len(test),"mae":round(model_mae,3),"hybridMae":round(hybrid_mae,3),"baselineMae":round(base_mae,3),"improvement":round(improvement,4),"rawIntervalCoverage":round(raw_coverage,4),"intervalCoverage":round(coverage,4),"biasMinutes":round(bias,3),"modelRideShare":round(model_ride_share,4),"fallbackRideShare":round(fallback_ride_share,4),"safeRideShare":round(safe_ride_share,4),"stableRideShare":round(stable_ride_share,4),"calibration":global_calibration,"promotionEligible":promotion_eligible,"qualityGatesPassed":gate_passed,"promotionGates":{"minimumImprovement":.05,"coverageRange":[.72,.88],"maximumAbsoluteBiasMinutes":5,"minimumSafeRideShare":.95},"perRide":per_ride,"closureModel":{"artifactPath":str(closure_artifact),"samples":len(closure_test),"accuracy":round(closure_accuracy,4),"brierScore":round(closure_brier,4)},"passed":passed,"features":FEATURES,"featureVersion":3,"selectionPolicy":"per-ride time-safe CatBoost with baseline fallback"}
 if passed:db.execute("UPDATE model_registry SET status='retired' WHERE status='champion'")
 status="champion" if passed else "shadow" if not promotion_eligible else "rejected"
 db.execute("INSERT OR REPLACE INTO model_registry VALUES(?,?,?,?,?,?,?,?)",(version,checked,"catboost-safe-hybrid-v3",status,len(days),json.dumps(metrics),str(artifact),checked if passed else None));db.commit();db.close();print(json.dumps({**metrics,"status":status}));return 0
if __name__=="__main__":raise SystemExit(main())
