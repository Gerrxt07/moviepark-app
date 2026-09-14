import ForecastRidesPage from "../../components/ForecastRidesPage";
export default async function Page({params}){const{date}=await params;return <ForecastRidesPage date={date}/>}
